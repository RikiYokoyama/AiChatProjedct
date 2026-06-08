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

const MODEL_LABELS: Record<string, string> = {
  'gemini-3.5-flash': 'Gemini 3.5 Flash',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-1.5-flash': 'Gemini 1.5 Flash',
};

export const SYSTEM_PROMPTS = {
  'deep-think': 'ユーザーの質問やテーマに対して前提知識を含めて徹底的に深掘りし、実質的な答えや解決策を必ず提示してください。回答内容は、最新の情報であるか、また事実関係が正確であるかを厳格にファクトチェックした上で、不確かな憶測を避けて信頼性の高い内容を作成してください。出力全体の長さは、Markdown記号等も含めて200文字〜500文字程度に収まるよう要約し、簡潔に回答してください。',
  'markdown-struct': 'バラバラのメモを綺麗に構造化し、そのままObsidianに貼り付けられる美しいMarkdown（見出し・箇条書き・要約・末尾に `tags: [タグ名]`）で出力してください。また、出力する文章全体の長さは、Markdown記号等も含めて200文字〜500文字程度に収まるように要約して構成してください。',
  'long-explain': '提示されたテーマについて、前提知識がない読者でも深く理解できるよう、網羅的で詳細な解説記事（目安：1000文字〜5000文字程度）を作成してください。単に要約するのではなく、背景、仕組み、具体例、メリット・デメリット、今後の展望まで詳細に執筆してください。箇条書きだけで終わらせず、各項目ごとに複数の段落を用いて丁寧な解説文（地の文）を記述してください。また、提供する情報はできる限り最新かつ正確な事実に基づいているか（ファクトチェック）を自ら厳格に検証した上で、信頼性の高い根拠を基に記述してください。'
};

export class GeminiClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * ブラウザ標準の fetch (REST API) を使用して、Gemini API と軽量かつ確実に通信します (Gemini CLI形式)。
   */
  async chatStream(
    history: ChatMessage[],
    mode: ChatMode,
    speedMode: AiSpeedMode,
    modelMode: AiModelMode,
    onChunk: (text: string) => void,
    onComplete: (fullText: string) => void,
    onError: (err: any) => void
  ) {
    if (!this.apiKey) {
      onError(new Error('APIキーが設定されていません。右上の「設定」からAPIキーを入力してください。'));
      return;
    }

    const models = MODEL_CANDIDATES[modelMode];
    let success = false;
    let lastError: any = null;

    const contents = history.map(msg => ({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    const systemInstruction = SYSTEM_PROMPTS[mode];
    const thinkingBudget = speedMode === 'thinking' ? -1 : 0;

    for (const model of models) {
      try {
        if (lastError) {
          onChunk(`\n\n*(${MODEL_LABELS[models[0]]} で接続できなかったため、${MODEL_LABELS[model] || model} へ自動切り替えして再試行中...)*\n\n`);
        }

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contents: contents,
              systemInstruction: {
                parts: [{ text: systemInstruction }]
              },
              generationConfig: {
                temperature: 0.7,
                thinkingConfig: {
                  thinkingBudget,
                },
              },
              safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
              ]
            })
          }
        );

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Response body reader is not available');
        }

        const decoder = new TextDecoder('utf-8');
        let fullText = '';
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const cleanLine = line.trim();
            if (!cleanLine) continue;
            
            if (cleanLine.startsWith('data:')) {
              try {
                const dataJson = JSON.parse(cleanLine.substring(5).trim());
                const textChunk = dataJson.candidates?.[0]?.content?.parts?.[0]?.text || '';
                if (textChunk) {
                  fullText += textChunk;
                  onChunk(textChunk);
                }
              } catch (e) {
                // Ignore parsing errors
              }
            }
          }
        }

        if (buffer && buffer.startsWith('data:')) {
          try {
            const dataJson = JSON.parse(buffer.substring(5).trim());
            const textChunk = dataJson.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (textChunk) {
              fullText += textChunk;
              onChunk(textChunk);
            }
          } catch (e) {}
        }

        if (!fullText.trim()) {
          throw new Error('Received empty text response from API');
        }

        onComplete(fullText);
        success = true;
        break;

      } catch (err: any) {
        console.warn(`Model ${model} failed:`, err);
        lastError = err;
      }
    }

    if (!success) {
      onError(lastError || new Error('すべてのモデルで接続に失敗しました。'));
    }
  }
}
