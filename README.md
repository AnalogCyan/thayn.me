# thayn.me

Personal website and portfolio for Cyan.

<p>
  <a href="https://app.netlify.com/projects/thayn/deploys">
    <img alt="Netlify Status" src="https://api.netlify.com/api/v1/badges/1ebab9b0-26fa-4390-81d4-8f3a6e388630/deploy-status" />
  </a>
  <a href="./LICENSE">
    <img alt="License: AGPL v3" src="https://img.shields.io/badge/Code-AGPL%20v3-blue.svg?style=flat-square" />
  </a>
  <a href="./LICENSE-CONTENT">
    <img alt="License: CC BY-SA 4.0" src="https://img.shields.io/badge/Content-CC%20BY--SA%204.0-lightgrey.svg?style=flat-square" />
  </a>
</p>

> [!WARNING]
> Redesign in progress. Some pages may be incomplete or broken.

## About

Source for [thayn.me](https://thayn.me), built without frameworks or bundlers.
The build is a Node.js script (`build.js`) that compiles Handlebars templates
and Markdown into static HTML/CSS/JS, deployed on Netlify. Pages, capsules and
the asset bundles come from the [GachaKit](https://github.com/AnalogCyan/GachaKit)
engine; the blog, feeds, webmentions and syndication are this repo's own.

Production dependencies: `gachakit`, `@netlify/blobs`, `front-matter`, `handlebars`,
`marked`, `parse5`.

### How it’s put together

- **Capsules** are self-contained components (HTML + CSS + JS) that compose into
  pages. See `src/capsules/` for the header, footer, ambient background, etc.
- **Blog** posts are Markdown with YAML frontmatter, syndicated to Mastodon and
  Bluesky via Bridgy on deploy.
- **Read-aloud**: a post can carry a narration with a word-by-word highlight
  that follows the audio. See [Narrating a post](#narrating-a-post).
- **Version**: each build writes `/version.json` with its version and commit.
  A clean build of main is `0.YYYYMMDD.N` (the UTC day of the commit, N
  counting main's commits that day) and a CI workflow tags it; anything else is
  `0.0.0-dev`.
- **Edge functions** block AI crawlers. Serverless functions proxy Last.fm data
  and fetch webmentions.

## TODO

- **Reduce JS reliance.** The CSP no longer allows inline styles. What remains
  is moving JS-driven elements to native CSS where practical:
  - mobile nav toggle → `popover`
  - container width tracking the nav → intrinsic CSS sizing
  - sliding nav highlight → anchor positioning
  - footer slide after navigation → a view transition

## Local development

Requires Node.js **>= v24**.

```sh
npm install
npm run dev      # build + serve at localhost:3000
npm run build    # build only (outputs to ./public)
npm test         # syndication, CSP and icon tests
npm run lint     # eslint
npm run format   # prettier
npm run icons    # re-cut the icon font after adding or removing an icon
```

## Narrating a post

1. Add `readAloud: true` to the post's front matter.
2. Run the narration tool with a TTS command:

   ```sh
   READ_ALOUD_TTS=/path/to/my-tts node tools/read-aloud/narrate.js <slug>
   ```

   It builds the site (drafts included), takes the narration text from the
   built page, has the TTS command speak it, aligns every word to the audio
   and writes:
   - `src/static/media/blog/read-aloud/<slug>.<hash>.m4a` and `.json` (timings)
   - `src/blog/read-aloud/<slug>.json`, the manifest

3. Commit those three files with the post.

The build renders the player only when the manifest's media exists and its
text hash still matches the post. Edit the post's words afterwards and the
build leaves the player out with a warning until you narrate it again.
Punctuation and formatting changes don't count. Recordings of drafts, stale
recordings and old versions never reach `public/`.

The narration is the title plus the post body, minus figures, code blocks,
footnotes, `<sup>` and anything inside an element with
`data-read-aloud-skip`. The rules live in `src/blog/scripts/audio-sync.js` and
the build, the tool and the page all use them.

**TTS command.** Any engine works. The tool runs
`$READ_ALOUD_TTS <script.txt> <out-dir>` through `sh` (or pass `--tts`).
`script.txt` is UTF-8 with one block of narration per line, the title first.
The command writes `out-dir/0001.wav`, `0002.wav` and so on, one WAV per line,
in any sample rate or channel count, and exits 0. The tool puts a pause
between blocks (`--pause`, default 0.6 seconds). Intermediate files go to a
fresh temp folder, or to `READ_ALOUD_WORK` if set.

**Alignment.** Word timings come from CTC forced alignment with torchaudio's
`WAV2VEC2_ASR_BASE_960H` model on CPU. The tool keeps its Python packages in a
venv outside the repo, `~/.cache/thayn-me/read-aloud-venv` (or
`READ_ALOUD_VENV`), made with `python3` (or `READ_ALOUD_PYTHON`) from
`tools/read-aloud/requirements.txt` on first run. The model downloads to the
torch cache on first use (about 360 MB). Audio conversion uses `afconvert` on
macOS and `ffmpeg` elsewhere. None of this runs on Netlify.

## Licensing

- **Code:** [AGPL v3](./LICENSE)
- **Content** (text, images, media): [CC BY-SA 4.0](./LICENSE-CONTENT)

If you reuse content, please attribute and keep derivatives under CC BY-SA 4.0.
