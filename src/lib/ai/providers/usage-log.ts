type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
};

/**
 * Une ligne de log par appel Claude: tokens facturés (entrée, sortie, cache) et
 * raison d'arrêt. Sert à voir ce que coûte chaque étape du pipeline; le `label`
 * dit laquelle. `stop=max_tokens` signale une réponse tronquée.
 */
export function formatUsageLog(input: {
  label?: string;
  model: string;
  usage: Usage;
  stopReason: string | null;
}): string {
  const { label, model, usage, stopReason } = input;
  return (
    `[usage anthropic] label=${label ?? "unlabeled"} model=${model}` +
    ` in=${usage.input_tokens} out=${usage.output_tokens}` +
    ` cache_read=${usage.cache_read_input_tokens ?? 0}` +
    ` cache_write=${usage.cache_creation_input_tokens ?? 0}` +
    ` stop=${stopReason ?? "none"}`
  );
}
