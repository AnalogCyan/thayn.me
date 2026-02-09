import type { Context } from "@netlify/edge-functions";
import agentDefinitions from "./agents.ts";

type AgentDefinition = {
  name: string;
  pattern: string;
  documentation?: string;
  type?: "substring" | "regex";
  caseSensitive?: boolean;
};

type CompiledAgent = AgentDefinition & {
  patternLower?: string;
  regex?: RegExp;
};

const compiledAgents: CompiledAgent[] = (
  agentDefinitions as AgentDefinition[]
).map((agent) => {
  if (agent.type === "regex") {
    return {
      ...agent,
      regex: new RegExp(agent.pattern, agent.caseSensitive ? undefined : "i"),
    } satisfies CompiledAgent;
  }

  return {
    ...agent,
    type: "substring",
    patternLower: agent.caseSensitive
      ? agent.pattern
      : agent.pattern.toLowerCase(),
  } satisfies CompiledAgent;
});

const AI_TRAINING_HEADER = "none";
const ROBOTS_DIRECTIVE = "noai, noimageai";

function detectBlockedAgent(userAgent: string | null): CompiledAgent | null {
  if (!userAgent) {
    return null;
  }

  for (const agent of compiledAgents) {
    if (agent.regex) {
      if (agent.regex.test(userAgent)) {
        return agent;
      }
      continue;
    }

    const haystack = agent.caseSensitive ? userAgent : userAgent.toLowerCase();

    if (haystack.includes(agent.patternLower ?? agent.pattern)) {
      return agent;
    }
  }

  return null;
}

export default async function botShield(request: Request, context: Context) {
  try {
    const userAgent = request.headers.get("user-agent");
    const matchedAgent = detectBlockedAgent(userAgent);

    if (matchedAgent) {
      context.log(
        `Blocked ${matchedAgent.name} via user-agent: ${userAgent ?? "<missing>"}`,
      );

      return new Response("AI scraping is not permitted on this site.", {
        status: 403,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "X-Robots-Tag": ROBOTS_DIRECTIVE,
          "AI-Training": AI_TRAINING_HEADER,
        },
      });
    }

    const upstreamResponse = await context.next();
    const headers = new Headers(upstreamResponse.headers);
    headers.set("X-Robots-Tag", ROBOTS_DIRECTIVE);
    headers.set("AI-Training", AI_TRAINING_HEADER);

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  } catch (error) {
    context.log(`botShield error; bypassing: ${String(error)}`);
    return context.next();
  }
}
