---
title: "Eternal October"
date: "2026-11-19T17:17:00.000Z"
categories:
  - "Security"
  - "AI"
excerpt: "Eternal September never ended. Now AI-driven attacks have done the same to October."
draft: false
readAloud: true
hashtags:
  - "InfoSec"
  - "AI"
  - "EternalSeptember"
syndicate:
  - "bluesky"
  - "mastodon"
syndication:
  {}
syndicationStatus:
  bluesky: "requested"
syndicationRequestedAt:
  bluesky: "2026-11-19T17:23:03.459Z"
syndicationCheckedAt:
  bluesky: "2026-11-19T17:23:03.459Z"
---

It used to be that every September, the internet broke a little, and every October, it healed. I missed it by a bit, I'm a little too young, but I know the history: [Usenet](https://en.wikipedia.org/wiki/Usenet) was the big public conversation network before the web, and through the eighties it ran mostly on university and research networks. Every September, a new class of freshmen logged in with fresh accounts. They top-posted. They typed in ALL CAPS. They asked questions the FAQ had been answering for years. The old-timers yelled at them. Some learned the rules, some gave up, and by October everything was quiet again. September was loud, but it ended. It always ended.

Then in September 1993 the commercial providers started plugging their users into Usenet, AOL followed in early 1994, and the September that always ended stopped ending. Their users didn't arrive on an academic calendar. They arrived constantly, in numbers the network had never had to absorb, and there was no October to clean up behind them. A Usenet user named Dave Fischer called it ["the September that never ended"](https://en.wikipedia.org/wiki/Eternal_September) in January 1994. Soon it was "Eternal September", and the name stuck because it's exactly right: the gates opened and never closed again. **Eternal September** stopped being a joke and became just, well, the weather.

Thirty-plus years later, I think it got a sibling. This October. I may have missed the original, but I'm stuck in the thick of the sequel.

<figure class="post-image">
  <img src="/media/blog/xkcd-2347-dependency.png" width="770" height="978" alt="xkcd comic: a tall, wobbly tower of blocks labeled “all modern digital infrastructure”, resting on one thin block labeled “a project some random person in Nebraska has been thanklessly maintaining since 2003”" loading="lazy" />
  <figcaption><a href="https://xkcd.com/2347/">xkcd #2347: “Dependency”</a> by Randall Munroe, <a href="https://creativecommons.org/licenses/by-nc/2.5/">CC BY-NC 2.5</a></figcaption>
</figure>

## Black October

People started calling it **Black October**[^1], and unlike a lot of security naming, this one was earned. On October 21, two critical flaws in the PHP runtime, soon nicknamed PHP2Shell, were reported exploited in the wild[^2]. PHP runs nearly 70% of websites, by some estimates[^3]. The fixes shipped about six hours after the first reports of attacks, which sounds heroic until you sit with the details: researchers had used AI to find the flaws[^4], two separate teams with two different models[^2], and there was no telling who else had. The next day, a viral post called the previous two days "the most serious 48 hours in cybersecurity history."[^5]

The rest of October looked the same: a supply-chain attack on LiteLLM that, for a couple of hours, shipped a password-stealing backdoor to anyone who installed the new version[^6], an intruder at Railway who may have reached customer environment variables and decrypted some of them[^7], Quest Diagnostics confirming a breach touching patients' personal and health data[^8], browser makers racing to distrust eMudhra after eight of the certificate authority's keys turned out to be guessable almost instantly[^9], and Japan's ruling party declaring "a state of emergency in cyber space" after a wave of attacks hit banks, rail and retail[^10]. And in South Korea, CrowdStrike assessed that a single individual with agentic AI tools was behind a series of attacks on financial institutions[^11]. Not all of that was AI. But it all landed at once, on people who were already stretched.

That last one is the part I can't stop thinking about. One person. One subscription, basically. Operations that used to take a crew now fit in a terminal window.

## The Difference

Eternal September was people. People get embarrassed. People learn, or get bored, or log off before finals. The flood had a season because it had humans in it.

October's flood is machines. They don't get embarrassed. They don't read the FAQ. They don't go home for Christmas break. The model hunting for vulnerabilities at 3am doesn't care that the semester started. This is what security people kept warning about. Anthropic's deputy CISO calls it a "vulnerability tsunami"[^12], the point where AI finds and exploits flaws faster than anyone can patch. In October he said the worst was still a few months out. October was the warm-up.

And the security mess is just the flood finally reaching the infrastructure itself. The rest of it, we've been wading through for years: generated slop in every feed, articles written by nothing, search results for products that don't exist. The dead internet theory isn't a theory anymore. October didn't start the flood. October was the month it knocked a hole in the dam.

## Eternal October

If October were the whole story, you could file it under bad month and move on. But it's mid-November as I write this, and the calendar flip changed nothing.

Google's threat intelligence team reported the first attackers they've caught finding and exploiting flaws with no human in the loop[^13], including a setup built to turn a fresh security patch into an exploit and launch it on its own. Japan unveiled an emergency cybersecurity package[^14] in the same weeks.

On November 17, Java got its own PHP2Shell: Java4Shell[^15], a critical memory-corruption flaw in the Base64 decoder of Java's HotSpot virtual machine that allows unauthenticated remote code execution. The next day PHP flagged critical fixes in its upcoming release[^16], and the same week Wiz Research published two critical flaws in NGINX's HTTP/2 support[^17] that let attackers take over servers without so much as a login.

October ended. The attacks didn't get the memo.

Now, people will argue the details, and they should. Some of October's incidents probably would have happened anyway, and, as D3 notes, Forkast called it "a disclosure wave, not an attack wave,"[^2] which is fair. Argue the forensics. The trend still points one way. AI that finds flaws like PHP2Shell is not going back in the box, and neither is the volume of attempts it enables. In mid-November the FBI warned that attackers had taken over an open-source AI penetration testing tool[^18] that turns plain-language goals into a full intrusion campaign. Script kiddies used to need someone else's exploit. Now they just ask for one.

That's what makes it _Eternal_. **Eternal September** didn't mean one bad month. It meant the quiet months were gone for good, and everyone had to live with the new normal. **Eternal October** is the same shape. October was the last month this stuff was rare. The baseline moved, and it is not moving back.

So what do you do about a season that never ends? Roughly what worked on the last one, adapted. Patch faster than the machines. Keep your corner of the internet small enough to actually know who's in it. This site already tells AI crawlers no in every way I can configure, because I still believe a personal site is a home, and a home gets to decide who comes in. The small web isn't nostalgia anymore. It's a lifeboat.

In 1993 the old guard tried to teach an endless flood of strangers some manners, and lost. This wave can't even read the room. So take the lesson that generation learned the hard way: don't wait for it to calm down.

It won't.

## Your Turn

Nobody elected Eternal September. Dave Fischer made a joke, it was true, and it stuck. Eternal October gets the same treatment: it's a working title, not a decree. If the internet finds something better, I'll use it.

Do you see the same shape I do? Is this a new climate, or a storm that will pass? I genuinely want to know where you think I'm wrong. Reply on [Mastodon](https://tech.lgbt/@AnalogCyan) or [Bluesky](https://bsky.app/profile/thayn.me), or skip the middleman and write your own post, then send me a webmention.

There's also a longer post about AI in general in the works. It's done when it's done: writing about a flood is easier when you're not also sandbagging against it, and AI keeps this sysadmin busy running three stacks while the industry rebuilds itself. More on that later.

For now, I crawl back into the server room. <span aria-hidden="true">&gt;:3</span>

---

[^1]: [Black October (information security), Wikipedia](<https://en.wikipedia.org/wiki/Black_October_(information_security)>)

[^2]: [Black October: What PHP2Shell, eMudhra and AI-Powered Attacks Mean for the SOC, D3 Security](https://d3security.com/blog/black-october-php2shell)

[^3]: [AI's "Black October": Critical PHP flaws set off global security scramble, CNBC](https://www.cnbc.com/2026/10/23/php-vulnerabilities-ai-cybersecurity.html)

[^4]: ["Black October": cybersecurity experts sound the alarm over new era of AI-enabled hacking, The Guardian](https://www.theguardian.com/technology/2026/oct/23/cybersecurity-ai-hacking-php-vulnerability)

[^5]: [The viral post: @AISafetyMemes on X, October 22, 2026](https://x.com/AISafetyMemes/status/2113113711644737835)

[^6]: [LiteLLM supply chain attack hoovers up passwords and secrets, The Register](https://theregister.com/security/2026/10/21/litellm-supply-chain-attack-hoovers-up-passwords-and-secrets/5304548)

[^7]: [Security Disclosure: Wednesday October 21st, Railway](https://blog.railway.com/p/security-disclosure-wednesday-october-21st)

[^8]: [Lab testing giant Quest Diagnostics confirms patients' personal and health data was compromised during breach, TechCrunch](https://techcrunch.com/2026/10/23/lab-testing-giant-quest-diagnostics-confirms-patients-personal-and-health-data-was-compromised-during-breach)

[^9]: [eMudhra to Exit Global SSL/TLS Business After 8 Intermediate CA Keys Found Easily Guessable, The Hacker News](https://thehackernews.com/2026/10/emudhra-to-exit-global-ssltls-business.html)

[^10]: [A spate of cyber attacks has rocked Japan, and it's spooked lawmakers, ITPro](https://itpro.com/security/cyber-attacks/a-spate-of-cyber-attacks-has-rocked-japan-and-its-spooked-lawmakers)

[^11]: [Cybersecurity's "Black October", Progressive Policy Institute](https://www.progressivepolicy.org/cybersecuritys-black-october)

[^12]: [Things Will Get Worse Before They Get Better: Anthropic Deputy Chief Information Security Officer On Recent Cyber Incidents, OfficeChai](https://officechai.com/ai/things-will-get-worse-before-they-get-better-anthropic-deputy-chief-information-security-officer-on-recent-cyber-incidents/)

[^13]: [GTIG AI Threat Tracker: Agentic Threat Activity Crosses a Significant Threshold, Google Cloud](https://cloud.google.com/blog/topics/threat-intelligence/agentic-threat-activity-crosses-a-significant-threshold)

[^14]: [Japan unveils emergency cybersecurity package amid data breach concerns, Mainichi](https://mainichi.jp/english/articles/20261106/p2g/00m/0na/053000c)

[^15]: [Critical Java Vulnerability Requires Immediate Patching, CISA](https://www.cisa.gov/news-events/alerts/2026/11/17/critical-java-vulnerability-requires-immediate-patching)

[^16]: [Upcoming Critical PHP Security Release scheduled for Thursday, 19 November 2026, PHP.net](https://www.php.net/archive/2026.php#2026-11-18-1)

[^17]: [Unauthenticated Remote Code Execution in NGINX: CVE-2026-123633 and CVE-2026-123007, Wiz Research](https://www.wiz.io/blog/nginx-http2-rce-vulnerabilities)

[^18]: [FLASH-20261113-001: Threat Overview of ARTEX Autonomous Penetration Testing Framework, FBI](https://www.ic3.gov/CSA/2026/261113.pdf)
