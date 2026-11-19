"""Word timings for narration clips by CTC forced alignment.

Usage: align.py <job.json> <out.json>

job.json is {"clips": [{"path": "0001.wav", "words": ["Eternal", ...]}, ...]}
with 16-bit PCM WAV clips. out.json gets, per clip, a [start, end] pair in
seconds for every word, plus the method used for each clip.

The acoustic model is torchaudio's WAV2VEC2_ASR_BASE_960H (English, letters
and apostrophe). Words it cannot spell, such as numbers, symbols and other
scripts, are aligned as a wildcard token that matches any sound.
"""

import json
import re
import sys
import unicodedata
import wave

import numpy as np
import torch
import torchaudio
import torchaudio.functional as F

BUNDLE = torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H
# Log probability of the wildcard on every frame: low enough that it does
# not swallow neighbouring words, high enough to cover a spoken number
STAR_LOG_PROB = -2.0
WINDOW_S = 30.0
CONTEXT_S = 2.0


def read_wav(path):
    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2:
            raise ValueError(f"{path}: expected 16-bit PCM")
        rate, channels = w.getframerate(), w.getnchannels()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    audio = torch.from_numpy(data.astype(np.float32) / 32768.0)
    audio = audio.reshape(-1, channels).mean(dim=1)[None]
    if rate != BUNDLE.sample_rate:
        audio = F.resample(audio, rate, BUNDLE.sample_rate)
    return audio


def emissions(model, audio):
    """Frame log probabilities, computed in windows so long clips fit."""
    rate = BUNDLE.sample_rate
    total = audio.size(1)
    window, context = int(WINDOW_S * rate), int(CONTEXT_S * rate)
    if total <= window + context:
        with torch.inference_mode():
            out, _ = model(audio)
        return torch.log_softmax(out, dim=-1)
    pieces = []
    for start in range(0, total, window):
        lo, hi = max(0, start - context), min(total, start + window + context)
        with torch.inference_mode():
            out, _ = model(audio[:, lo:hi])
        frames = out.size(1)
        per_sample = frames / (hi - lo)
        a = round((start - lo) * per_sample)
        b = round((min(total, start + window) - lo) * per_sample)
        pieces.append(out[:, a:b])
    return torch.log_softmax(torch.cat(pieces, dim=1), dim=-1)


def spell(word, vocab):
    if re.search(r"\d", word):
        return None
    letters = unicodedata.normalize("NFKD", word).upper().replace("’", "'")
    letters = [c for c in letters if c in vocab and c not in "-|"]
    return letters if any(c != "'" for c in letters) else None


def proportional(words, seconds):
    weights = [len(w) + 1 for w in words]
    total, at, out = sum(weights), 0.0, []
    for weight in weights:
        span = weight / total * seconds
        out.append([at, at + span])
        at += span
    return out


def align_clip(model, labels, clip):
    vocab = {c: i for i, c in enumerate(labels)}
    star = len(labels)
    words = clip["words"]
    audio = read_wav(clip["path"])
    seconds = audio.size(1) / BUNDLE.sample_rate
    if not words:
        return [], "empty"

    em = emissions(model, audio)
    em = torch.cat([em, torch.full((1, em.size(1), 1), STAR_LOG_PROB)], dim=2)

    tokens, owner = [], []
    for i, word in enumerate(words):
        if tokens:
            tokens.append(vocab["|"])
            owner.append(-1)
        letters = spell(word, vocab)
        for t in [vocab[c] for c in letters] if letters else [star]:
            tokens.append(t)
            owner.append(i)

    if len(tokens) > em.size(1):
        return proportional(words, seconds), "proportional"
    try:
        ali, scores = F.forced_align(em, torch.tensor([tokens]), blank=0)
    except RuntimeError as err:
        print(f"align: falling back to proportional timings: {err}", file=sys.stderr)
        return proportional(words, seconds), "proportional"

    spans = F.merge_tokens(ali[0], scores[0].exp())
    if len(spans) != len(tokens):
        return proportional(words, seconds), "proportional"
    per_frame = audio.size(1) / em.size(1) / BUNDLE.sample_rate
    out = [None] * len(words)
    for span, i in zip(spans, owner):
        if i < 0:
            continue
        start, end = span.start * per_frame, span.end * per_frame
        if out[i] is None:
            out[i] = [start, end]
        else:
            out[i][1] = end
    return out, "ctc"


def main():
    job_path, out_path = sys.argv[1], sys.argv[2]
    job = json.load(open(job_path, encoding="utf-8"))
    model = BUNDLE.get_model().eval()
    labels = BUNDLE.get_labels()
    clips, methods = [], []
    for n, clip in enumerate(job["clips"], 1):
        times, method = align_clip(model, labels, clip)
        clips.append([[round(a, 3), round(b, 3)] for a, b in times])
        methods.append(method)
        print(f"align: clip {n}/{len(job['clips'])} {method}", file=sys.stderr)
    json.dump({"clips": clips, "methods": methods}, open(out_path, "w"))


if __name__ == "__main__":
    main()
