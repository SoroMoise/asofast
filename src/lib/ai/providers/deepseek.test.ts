import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// On ne mocke que le réseau (fetch): le vrai SDK `openai` construit la vraie
// requête, ce qui permet de vérifier exactement ce qui part vers DeepSeek.
const fetchMock = vi.fn();

/** Le client est mis en cache par module: on recharge le provider pour chaque test. */
async function loadProvider() {
  vi.resetModules();
  return import("./deepseek");
}

function chatResponse(content: string | null, finishReason = "stop"): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1,
      model: "deepseek-flash",
      choices: [
        { index: 0, message: { role: "assistant", content }, finish_reason: finishReason },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function sentRequest(call = 0) {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return {
    url: String(url),
    headers: new Headers(init.headers),
    body: JSON.parse(init.body as string),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
  delete process.env.DEEPSEEK_MODEL;
  delete process.env.DEEPSEEK_VISION_MODEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("completeJSON (DeepSeek)", () => {
  // Casse si: mauvaise baseURL, JSON mode absent, ou `thinking` non désactivé
  // (le thinking est actif par défaut: ~10x de tokens facturés et `temperature`
  // ignorée — constaté sur l'API réelle).
  it("appelle DeepSeek en JSON mode avec le thinking désactivé et parse la réponse", async () => {
    fetchMock.mockResolvedValueOnce(chatResponse('{"keywords":["photo","filters"]}'));
    const { completeJSON } = await loadProvider();

    const out = await completeJSON("Return JSON keywords.", "Photo editor app");

    expect(out).toEqual({ keywords: ["photo", "filters"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, headers, body } = sentRequest();
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(body.model).toBe("deepseek-flash");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(8192);
    expect(body.messages).toEqual([
      { role: "system", content: "Return JSON keywords." },
      { role: "user", content: "Photo editor app" },
    ]);
  });

  it("honore DEEPSEEK_MODEL", async () => {
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-v4-pro");
    fetchMock.mockResolvedValueOnce(chatResponse("{}"));
    const { completeJSON } = await loadProvider();

    await completeJSON("Return JSON.", "hi");

    expect(sentRequest().body.model).toBe("deepseek-v4-pro");
  });

  // DeepSeek exige le mot "json" dans les messages pour le JSON mode. Les
  // prompts sont éditables en DB: on garantit la contrainte ici.
  it("ajoute la consigne JSON quand aucun message ne contient le mot json", async () => {
    fetchMock.mockResolvedValueOnce(chatResponse("{}"));
    const { completeJSON } = await loadProvider();

    await completeJSON("You write app titles.", "Photo editor app");

    expect(sentRequest().body.messages[1].content).toBe(
      "Photo editor app\n\nRespond only in JSON."
    );
  });

  it("laisse le message user intact quand le system parle déjà de json", async () => {
    fetchMock.mockResolvedValueOnce(chatResponse("{}"));
    const { completeJSON } = await loadProvider();

    await completeJSON("Answer in JSON.", "Photo editor app");

    expect(sentRequest().body.messages[1].content).toBe("Photo editor app");
  });

  // Postgres refuse U+0000: même garde que les autres providers.
  it("retire les NUL des valeurs chaîne de la sortie", async () => {
    fetchMock.mockResolvedValueOnce(chatResponse('{"title":"a\\u0000b"}'));
    const { completeJSON } = await loadProvider();

    expect(await completeJSON("JSON.", "x")).toEqual({ title: "ab" });
  });

  // La doc DeepSeek prévient que le JSON mode peut renvoyer un contenu vide.
  it("réessaie une fois quand le contenu est vide", async () => {
    fetchMock
      .mockResolvedValueOnce(chatResponse(""))
      .mockResolvedValueOnce(chatResponse('{"ok":true}'));
    const { completeJSON } = await loadProvider();

    expect(await completeJSON("JSON.", "x")).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Renvoyer {} en silence ferait écrire une fiche vide en aval.
  it("échoue au lieu de renvoyer {} quand le contenu reste vide", async () => {
    fetchMock
      .mockResolvedValueOnce(chatResponse(null))
      .mockResolvedValueOnce(chatResponse("  "));
    const { completeJSON } = await loadProvider();

    await expect(completeJSON("JSON.", "x")).rejects.toThrow(/empty/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("signale une sortie tronquée (finish_reason=length) sans réessayer", async () => {
    fetchMock.mockResolvedValueOnce(chatResponse('{"title":"cut off', "length"));
    const { completeJSON } = await loadProvider();

    await expect(completeJSON("JSON.", "x")).rejects.toThrow(/truncated/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("échoue clairement quand DEEPSEEK_API_KEY est absente", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const { completeJSON } = await loadProvider();

    await expect(completeJSON("JSON.", "x")).rejects.toThrow("DEEPSEEK_API_KEY is not set");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("completeJSONWithImages (DeepSeek)", () => {
  const DATA_URL = "data:image/png;base64,AAAA";

  // Casse si: image_url mal formé, images perdues, JSON mode/thinking oubliés.
  it("envoie le texte puis les images (URL http et data URL) en JSON mode", async () => {
    fetchMock.mockResolvedValueOnce(chatResponse('{"text":"HELLO"}'));
    const { completeJSONWithImages } = await loadProvider();

    const out = await completeJSONWithImages("Describe in JSON.", "What is shown?", [
      "https://example.com/a.png",
      DATA_URL,
    ]);

    expect(out).toEqual({ text: "HELLO" });
    const { body } = sentRequest();
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.messages[0]).toEqual({ role: "system", content: "Describe in JSON." });
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toEqual([
      { type: "text", text: "What is shown?" },
      { type: "image_url", image_url: { url: "https://example.com/a.png", detail: "auto" } },
      { type: "image_url", image_url: { url: DATA_URL, detail: "auto" } },
    ]);
  });

  it("n'envoie que les 6 premières images", async () => {
    fetchMock.mockResolvedValueOnce(chatResponse("{}"));
    const { completeJSONWithImages } = await loadProvider();
    const urls = Array.from({ length: 8 }, (_, i) => `https://example.com/${i}.png`);

    await completeJSONWithImages("JSON.", "look", urls);

    const parts = sentRequest().body.messages[1].content as { type: string }[];
    expect(parts.filter((p) => p.type === "image_url")).toHaveLength(6);
  });

  // deepseek-v4-pro n'a pas la vision et NE plante PAS: il répond "cannot read
  // image" dans un JSON valide (constaté). La vision ne doit donc jamais hériter
  // d'un DEEPSEEK_MODEL sans vision.
  it("garde deepseek-flash pour la vision même si DEEPSEEK_MODEL est un modèle sans vision", async () => {
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-v4-pro");
    fetchMock.mockResolvedValueOnce(chatResponse("{}"));
    const { completeJSONWithImages } = await loadProvider();

    await completeJSONWithImages("JSON.", "look", [DATA_URL]);

    expect(sentRequest().body.model).toBe("deepseek-flash");
  });

  it("honore DEEPSEEK_VISION_MODEL", async () => {
    vi.stubEnv("DEEPSEEK_VISION_MODEL", "my-vision-model");
    fetchMock.mockResolvedValueOnce(chatResponse("{}"));
    const { completeJSONWithImages } = await loadProvider();

    await completeJSONWithImages("JSON.", "look", [DATA_URL]);

    expect(sentRequest().body.model).toBe("my-vision-model");
  });

  it("réessaie une fois quand le contenu est vide", async () => {
    fetchMock
      .mockResolvedValueOnce(chatResponse(""))
      .mockResolvedValueOnce(chatResponse('{"ok":true}'));
    const { completeJSONWithImages } = await loadProvider();

    expect(await completeJSONWithImages("JSON.", "look", [DATA_URL])).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
