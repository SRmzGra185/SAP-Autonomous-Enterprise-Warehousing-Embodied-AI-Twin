// Applicability references, not legal advice, conformity assessment, or a safety controller.
const standards = {
  risk: { code: "ISO 12100:2010", purpose: "Machine risk assessment and risk reduction", url: "https://www.iso.org/standard/51528.html" },
  robot: { code: "ISO 10218-1:2025", purpose: "Industrial robot safety; check applicability to exact hardware", url: "https://www.iso.org/standard/73933.html" },
  cell: { code: "ISO 10218-2:2025", purpose: "Industrial robot applications and cell integration", url: "https://committee.iso.org/standard/73934.html" },
  controls: { code: "ISO 13849-1:2023", purpose: "Safety-related control-system design; required PL determined by risk assessment", url: "https://www.iso.org/standard/73481.html" },
  information: { code: "ISO/IEC 27001:2022", purpose: "Information-security management", url: "https://www.iso.org/standard/27001" },
  ai: { code: "ISO/IEC 42001:2023", purpose: "AI management and accountability", url: "https://www.iso.org/standard/42001" },
  ot: { code: "IEC 62443-3-2:2020", purpose: "IACS security risk assessment, zones and conduits", url: "https://webstore.iec.ch/en/publication/30727" }
};
export function governanceFor(scenarioId) {
  const robotCell = scenarioId !== "autonomous-inspection";
  return {
    status: "Reference mapping only; not certified, independently assessed or production ready",
    standards: ["risk", "controls", "information", "ai", "ot", ...(robotCell ? ["robot", "cell"] : [])].map(key => standards[key]),
    requiredReview: ["Approved operating envelope and task-specific risk assessment", "Device identity and capability verification", "Validated local stop/interlocks independent of the browser", "Authorized actor and time-bounded approval", "Evidence freshness, identity and exception read-back"],
    robotBoundary: "Unitree model/configuration pending. Do not infer ISO 10218 applicability or industrial-safety conformity for a legged inspection robot. UR5 collaborative branding alone does not make the cell safe.",
    transportBoundary: "ISO 3691-4:2023 concerns driverless industrial trucks, not automatically a quadruped. Assess it only if a qualifying transport subsystem is introduced.",
    sourceCheckedAt: "2026-09-16", liveCommands: false
  };
}
