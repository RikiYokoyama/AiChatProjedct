export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export type ChatMode = 'deep-think' | 'markdown-struct' | 'long-explain' | 'prompt-gen' | 'long-doc';
export type AiModelMode = 'flash-lite' | 'flash' | 'pro';

const MODEL_CANDIDATES: Record<AiModelMode, string[]> = {
  'flash-lite': ['gemini-3.1-flash-lite-preview'],
  flash: ['gemini-3.5-flash'],
  pro: ['gemini-3.1-pro-preview', 'gemini-3.5-flash'],
};

export const SYSTEM_PROMPTS: Record<ChatMode, string> = {
  'deep-think': 'ユーザーの質問やテーマに対して前提知識を含めて徹底的に深掘りし、実質的な答えや解決策を必ず提示してください。回答内容は、最新の情報であるか、また事実関係が正確であるかを厳格にファクトチェックした上で、不確かな憶測を避けて信頼性の高い内容を作成してください。出力全体の長さは、Markdown記号等も含めて200文字〜500文字程度に収まるよう要約し、簡潔に回答してください。回答の作成にあたっては、【内部リンク生成ルール】（重要な概念、プロジェクト名、特定のツール名、日付、または重要なキーワードは半角の二重ブラケットで囲み、Obsidianの内部リンク形式 `[[キーワード]]` や `[[実際のノート名|表示名]]` で積極的に出力する。未作成ノートでも構わないが、過剰な繰り返しや日常単語へのリンクは避ける）を厳格に適用してください。',
  'markdown-struct': 'バラバラのメモを綺麗に構造化し、そのままObsidianに貼り付けられる美しいMarkdown（見出し・箇条書き・要約・末尾に `tags: [タグ名]`）で出力してください。また、出力する文章全体の長さは、Markdown記号等も含めて200文字〜500文字程度に収まるように要約して構成してください。回答の作成にあたっては、【内部リンク生成ルール】（重要な概念、プロジェクト名、特定のツール名、日付、または重要なキーワードは半角の二重ブラケットで囲み、Obsidianの内部リンク形式 `[[キーワード]]` や `[[実際のノート名|表示名]]` で積極的に出力する。未作成ノートでも構わないが、過剰な繰り返しや日常単語へのリンクは避ける）を厳格に適用してください。',
  'long-explain': '提示されたテーマについて、前提知識がない読者でも深く理解できるよう、網羅的で詳細な解説記事（目安：1000文字〜5000文字程度）を作成してください。単に要約するのではなく、背景、仕組み、具体例、メリット・デメリット、今後の展望まで詳細に執筆してください。箇条書きだけで終わらせず、各項目ごとに複数の段落を用いて丁寧な解説文（地の文）を記述してください。また、提供する情報はできる限り最新かつ正確な事実に基づいているか（ファクトチェック）を自ら厳格に検証した上で、信頼性の高い根拠を基に記述してください。回答の作成にあたっては、【内部リンク生成ルール】（重要な概念、プロジェクト名、特定のツール名、日付、または重要なキーワードは半角 of 二重ブラケットで囲み、Obsidianの内部リンク形式 `[[キーワード]]` や `[[実際のノート名|表示名]]` で積極的に出力する。未作成ノートでも構わないが、過剰な繰り返しや日常単語へのリンクは避ける）を厳格に適用してください。',
  'prompt-gen': 'ユーザーの要望に合わせて、AIチャット用のカスタムプロンプト（指示内容）を作成してください。出力の最後（または返答内）に、必ず以下の [PROMPT] フォーマットのブロックを含めて出力してください。ブロック外の説明は簡潔にし、最後に必ず「このプロンプトを追加しますか？」と1行で質問してください。\n\n【重要】名前フィールドは必ず10文字以内の短い日本語にしてください（例: 翻訳補助、議事録、要件定義）。\n\n[PROMPT]\n名前: 10文字以内の短い表示名\n指示: AIに対する具体的なシステムプロンプト指示テキスト全体\n[/PROMPT]\n\nこのプロンプトを追加しますか？',
  'long-doc': 'あなたは長文ドキュメント解析の専門家です。ノートコンテキストとして渡された文書全体（または会話に貼り付けられたテキスト）を精読し、ユーザーの指示に答えてください。\n\n【対応できる作業】\n- 要約・要点抽出（「要約して」「ポイントをまとめて」）\n- 質疑応答（「〇〇について教えて」）\n- 構造分析（「章ごとにまとめて」「目次を作って」）\n- 比較・評価（「メリット・デメリットを整理して」）\n- アクションアイテム抽出（「次にやることを箇条書きで」）\n\n【回答ルール】\n- 文書の具体的な箇所を引用して根拠を示す\n- ユーザーの指示に応じて出力の長さを調整する（要約なら簡潔に、詳細解説なら詳しく）\n- 重要な概念は [[キーワード]] 形式（Obsidian内部リンク）で出力する\n- 文書に記載のない事項は推測せず「文書中に記載なし」と明示する',
};

export async function generateNoteTitle(apiKey: string, userPrompt: string, aiReply: string): Promise<string> {
  const prompt = `以下の会話から、Markdownのファイル名に適した短いタイトル（20文字以内、日本語可）を1行だけ出力してください。記号や説明は不要です。\n\nUser: ${userPrompt.slice(0, 300)}\nAI: ${aiReply.slice(0, 300)}`;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
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

export async function generateNoteTags(apiKey: string, userPrompt: string, aiReply: string): Promise<string[]> {
  const prompt = `以下の会話から、話の内容に合うキーワードの「タグ」を1〜3個推測し、カンマ区切りのリストで出力してください。ハッシュ記号（#）は含めず、純粋なキーワードだけを出力してください。説明や記号、前置きなどは不要です。\n出力例: 仕事, タグ, 開発\n\nUser: ${userPrompt.slice(0, 300)}\nAI: ${aiReply.slice(0, 300)}`;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
      },
    );
    if (!response.ok) throw new Error('tag generation failed');
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    if (!text) return [];
    return text.split(/[,，、]/).map((t: string) => t.trim().replace(/^#/, '')).filter(Boolean);
  } catch {
    return [];
  }
}

export interface NoteInfo {
  name: string;
  tags: string[];
  snippet: string;
}

export async function generateMocContent(apiKey: string, mocTitle: string, noteInfos: NoteInfo[]): Promise<string> {
  const list = noteInfos
    .map(n => `- ${n.name.replace(/\.md$/i, '')}${n.tags.length ? ` (タグ: ${n.tags.join(', ')})` : ''}${n.snippet ? ` — ${n.snippet}` : ''}`)
    .join('\n');
  const prompt = `あなたはObsidianのMOC（Map of Content）エキスパートです。\n以下のノートリストを分析し、「${mocTitle}」というタイトルのMOCをMarkdown形式で作成してください。\n\n【ルール】\n- 関連するノートをテーマ別にグループ化し、見出し（##）でセクションを分ける\n- 各ノートは必ず [[ノート名]] 形式の内部リンクで記述する\n- 各リンクに1行の簡潔な説明を加える\n- 前置きや説明文は不要。Markdownの本文のみ出力する\n- ノート数が多い場合は重要度の高いものを優先する\n\nノートリスト:\n${list}`;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
    },
  );
  if (!response.ok) throw new Error(`Gemini APIエラー (${response.status})`);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

export async function generateTagsFromContent(apiKey: string, noteContent: string, allTags: string[] = []): Promise<string[]> {
  const tagHint = allTags.length > 0
    ? `\n\n既存のタグ候補（これらの中から適切なものを優先して選び、該当するものがなければ新しく作ってください）:\n${allTags.join(', ')}`
    : '';
  const prompt = `以下のノート本文を読み、内容に合うキーワードの「タグ」を1〜3個推測し、カンマ区切りのリストで出力してください。ハッシュ記号（#）は含めず、純粋なキーワードだけを出力してください。説明や記号、前置きなどは不要です。\n出力例: 仕事, タグ, 開発${tagHint}\n\n${noteContent.slice(0, 4000)}`;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
      },
    );
    if (!response.ok) throw new Error('tag generation failed');
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    if (!text) return [];
    return text.split(/[,，、]/).map((t: string) => t.trim().replace(/^#/, '')).filter(Boolean);
  } catch {
    return [];
  }
}

export class GeminiClient {
  constructor(private readonly apiKey: string) { }

  async chatStream(
    history: ChatMessage[],
    systemInstruction: string,
    modelMode: AiModelMode,
    noteContext: string | null,
    onChunk: (text: string) => void,
    onComplete: (fullText: string) => void,
    onError: (err: unknown) => void,
    options?: { contextLimit?: number },
  ) {
    if (!this.apiKey) {
      onError(new Error('Gemini APIキーが設定されていません。設定画面でAPIキーを入力してください。'));
      return;
    }

    const contents = history.map((message) => ({
      role: message.role,
      parts: [{ text: message.content }],
    }));

    const contextLimit = options?.contextLimit ?? 12000;
    const systemText = noteContext
      ? `${systemInstruction}\n\n---\n以下は現在開いているノートの内容です。この内容を前提に回答してください:\n\n${noteContext.slice(0, contextLimit)}`
      : systemInstruction;

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
              },
            }),
          },
        );

        if (!response.ok) {
          const status = response.status;
          if (status === 429) throw new Error('リクエストが多すぎます（レート制限）。少し時間をおいてから再送してください。');
          if (status === 503) throw new Error('Geminiサーバーが一時的に混雑しています（503）。しばらく待ってから再試行してください。');
          if (status === 401 || status === 403) throw new Error('APIキーが無効または権限がありません。設定を確認してください。');
          if (status === 400) throw new Error('リクエストの形式が正しくありません（400）。モデルまたは入力内容を確認してください。');
          throw new Error(`Gemini APIエラー（${status}）: 時間をおいて再試行してください。`);
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
