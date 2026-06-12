// キーボード表示時に入力欄が隠れないようにするためのフック
// ネイティブでは Capacitor Keyboard プラグイン、Web では visualViewport を使う
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      const showSub = Keyboard.addListener('keyboardWillShow', (info) => {
        setInset(info.keyboardHeight);
      });
      const hideSub = Keyboard.addListener('keyboardWillHide', () => setInset(0));
      return () => {
        showSub.then((s) => s.remove());
        hideSub.then((s) => s.remove());
      };
    }

    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const bottom = window.innerHeight - vv.height - vv.offsetTop;
      setInset(Math.max(0, bottom));
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
    };
  }, []);

  return inset;
}
