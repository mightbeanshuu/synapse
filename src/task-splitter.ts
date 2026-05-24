import { runCLI } from './runner';
import type { ComplexityProfile } from './complexity';

export interface TrackDecomposition {
  trackA: { label: string; scope: string };
  trackB: { label: string; scope: string };
  interfacesHint: string;
}

function decompositionPrompt(brief: string, complexity?: ComplexityProfile): string {
  const complexitySection = complexity ? `
COMPLEXITY LEVEL: ${complexity.label} — ${complexity.description}
ALLOWED TECH STACK: ${complexity.techStack}

IMPORTANT: The track split MUST respect the complexity constraints. For example:
- Simple → Track A = all HTML/CSS/JS files, Track B = styling polish + testing (NO backend tracks)
- Basic → Track A = minimal server + SQLite, Track B = frontend views
- Medium → Track A = backend API + DB, Track B = frontend + auth integration
- Advanced → Track A = backend services + infra, Track B = frontend + CI/CD
` : '';

  return `You are a senior architect. Split this project brief into two PARALLEL workstreams that can be built simultaneously with minimal conflicts.

PROJECT BRIEF:
${brief}
${complexitySection}
Output EXACTLY in this format — no intro, no fences:

TRACK_A_LABEL: [short name, e.g. "Backend & API"]
TRACK_A_SCOPE: [what files/modules this track owns, e.g. "src/api/, src/db/, src/models/, server.ts, package.json"]

TRACK_B_LABEL: [short name, e.g. "Frontend & UI"]
TRACK_B_SCOPE: [what files/modules this track owns, e.g. "src/components/, src/pages/, src/hooks/, src/styles/, vite.config.ts"]

INTERFACES: [key contracts they must share, e.g. "REST API endpoints in /api/*, TypeScript types in src/types.ts, env vars in .env.example"]

Make the split clean so the two tracks do NOT step on the same files. Be specific about directory ownership.`;
}

function parse(output: string): TrackDecomposition | null {
  const al = output.match(/TRACK_A_LABEL:\s*(.+)/i);
  const as_ = output.match(/TRACK_A_SCOPE:\s*(.+)/i);
  const bl = output.match(/TRACK_B_LABEL:\s*(.+)/i);
  const bs = output.match(/TRACK_B_SCOPE:\s*(.+)/i);
  const iface = output.match(/INTERFACES:\s*(.+)/i);

  if (!al || !as_ || !bl || !bs) return null;
  return {
    trackA: { label: al[1].trim(), scope: as_[1].trim() },
    trackB: { label: bl[1].trim(), scope: bs[1].trim() },
    interfacesHint: iface?.[1]?.trim() ?? 'INTERFACES.md',
  };
}

const FALLBACK: TrackDecomposition = {
  trackA: { label: 'Backend & Core Logic', scope: 'src/api/, src/db/, src/models/, src/services/, server.ts, package.json' },
  trackB: { label: 'Frontend & UI',        scope: 'src/components/, src/pages/, src/hooks/, src/styles/, index.html, vite.config.ts' },
  interfacesHint: 'REST API endpoints, TypeScript types in src/types.ts, shared env vars in .env.example',
};

export async function decomposeToTracks(
  brief: string,
  complexity?: ComplexityProfile
): Promise<TrackDecomposition> {
  try {
    const result = await runCLI('claude', 'Claude (Planner)', decompositionPrompt(brief, complexity), '/tmp');
    return parse(result.output) ?? FALLBACK;
  } catch {
    return FALLBACK;
  }
}
