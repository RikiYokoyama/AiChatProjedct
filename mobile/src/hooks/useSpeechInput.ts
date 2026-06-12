// 音声入力フック（Web Speech API — Android WebView / iOS WKWebView 対応状況に応じて利用）
import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: any) => void) | null;
}

function getRecognition(): SpeechRecognitionLike | null {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  return new Ctor();
}

export function useSpeechInput(onText: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [supported] = useState(() => Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stop = useCallback(() => {
    recogRef.current?.stop();
    setIsListening(false);
  }, []);

  const start = useCallback(() => {
    const recog = getRecognition();
    if (!recog) return;
    recogRef.current = recog;
    recog.lang = 'ja-JP';
    recog.interimResults = false;
    recog.continuous = true;
    recog.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          onTextRef.current(result[0].transcript);
        }
      }
    };
    recog.onend = () => setIsListening(false);
    recog.onerror = () => setIsListening(false);
    recog.start();
    setIsListening(true);
  }, []);

  useEffect(() => () => recogRef.current?.stop(), []);

  return { supported, isListening, start, stop };
}
