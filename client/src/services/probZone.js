// client/src/services/probZone.js
// Zonas de cor da "força do sinal" (0–100%, alinhamento dos indicadores — não é chance de lucro).
//   < 50   : neutro
//   50–75  : "Formando"   — âmbar   (está se alinhando, fique de olho)
//   75–85  : "Prepare-se" — laranja (perto do gatilho)
//   >= 85  : "Entrada"    — verde   (gate do sinal)
// As classes Tailwind aparecem literais porque o CDN só reconhece strings literais.

const ZONES = {
  none: {
    key: "none",
    label: "—",
    text: "text-gray-500",
    bar: "bg-gray-300",
    chip: "bg-gray-100 text-gray-600",
    dot: "bg-gray-300",
  },
  watch: {
    key: "watch",
    label: "Formando",
    text: "text-amber-600",
    bar: "bg-amber-400",
    chip: "bg-amber-100 text-amber-700",
    dot: "bg-amber-400",
  },
  ready: {
    key: "ready",
    label: "Prepare-se",
    text: "text-orange-600",
    bar: "bg-orange-500",
    chip: "bg-orange-100 text-orange-700",
    dot: "bg-orange-500",
  },
  go: {
    key: "go",
    label: "Entrada",
    text: "text-green-600",
    bar: "bg-green-600",
    chip: "bg-green-100 text-green-700",
    dot: "bg-green-600",
  },
};

export function zoneKey(p) {
  const v = Number(p) || 0;
  if (v >= 85) return "go";
  if (v >= 75) return "ready";
  if (v >= 50) return "watch";
  return "none";
}

/** @param {number} p probabilidade 0..100  @param {string} [stage] "go"|"ready"|"watch"|"none" do back-end (tem prioridade) */
export function probZone(p, stage) {
  return ZONES[stage && ZONES[stage] ? stage : zoneKey(p)];
}

export const ZONE_LEGEND = [ZONES.watch, ZONES.ready, ZONES.go];
