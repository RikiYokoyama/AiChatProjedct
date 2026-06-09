export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export type ChatMode = 'deep-think' | 'markdown-struct' | 'long-explain';
export type AiSpeedMode = 'thinking' | 'fast';
export type AiModelMode = 'flash-lite' | 'flash' | 'flash-3-5';

const MODEL_CANDIDATES: Record<AiModelMode, string[]> = {
  'flash-lite': ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-1.5-flash'],
  flash: ['gemini-2.5-flash', 'gemini-1.5-flash'],
  'flash-3-5': ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'],
};

const SYSTEM_PROMPTS: Record<ChatMode, string> = {
  'deep-think': 'ユーザーの質問に対して、事実確認を重視しながら具体的で実用的に回答してください。',
  'markdown-struct': '入力内容をObsidianで使いやすいMarkdownに整理してください。見出し、箇条書き、必要ならtagsを付けてください。',
  'long-explain': '背景、仕組み、具体例、注意点を含めて、読み手が理解できるように詳しく説明してください。',
};

export async function generateNoteTitle(apiKey: string, userPrompt: string, aiReply: string): Promise<string> {
  const prompt = `以下の会話から、Markdownのファイル名に適した短いタイトル（20文字以内、日本語可）を1行だけ出力してください。記号や説明は不要です。\n\nUser: ${userPrompt.slice(0, 300)}\nAI: ${aiReply.slice(0, 300)}`;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
      },
    );
    if (!response.ok) throw new Error('title generation failed');
    const data = await response.json();
    const title = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    return title || 'AIチャット';
  } catch {
    return 'AIチャット';
  }
}

export class GeminiClient {
  constructor(private readonly apiKey: string) {}

  async chatStream(
    history: ChatMessage[],
    mode: ChatMode,
    speedMode: AiSpeedMode,
    modelMode: AiModelMode,
    noteContext: string | null,
    onChunk: (text: string) => void,
    onComplete: (fullText: string) => void,
    onError: (err: unknown) => void,
  ) {
    if (!this.apiKey) {
      onError(new Error('Gemini APIキーが設定されていません。設定画面でAPIキーを入力してください。'));
      return;
    }

    const contents = history.map((message) => ({
      role: message.role,
      parts: [{ text: message.content }],
    }));

    const basePrompt = SYSTEM_PROMPTS[mode];
    const systemText = noteContext
      ? `${basePrompt}\n\n---\n以下は現在開いているノートの内容です。この内容を前提に回答してください:\n\n${noteContext.slice(0, 12000)}`
      : basePrompt;

    let lastError: unknown = null;

    for (const model of MODEL_CANDIDATES[modelMode]) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents,
              systemInstruction: { parts: [{ text: systemText }] },
              generationConfig: {
                temperature: 0.7,
                thinkingConfig: { thinkingBudget: speedMode === 'thinking' ? -1 : 0 },
              },
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`Gemini API error ${response.status}: ${await response.text()}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('Gemini APIの応答本文を読めませんでした。');

        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            const parsed = JSON.parse(payload);
            const chunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            if (chunk) {
              fullText += chunk;
              onChunk(chunk);
            }
          }
        }

        if (!fullText.trim()) throw new Error('Gemini APIから空の応答が返りました。');
        onComplete(fullText);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    onError(lastError ?? new Error('すべてのGeminiモデルで応答を取得できませんでした。'));
  }
}
