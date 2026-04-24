import { useEffect, useState } from 'react';

export function useOnlineStatus(): { online: boolean } {
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    function setOnlineTrue() { setOnline(true); }
    function setOnlineFalse() { setOnline(false); }
    window.addEventListener('online', setOnlineTrue);
    window.addEventListener('offline', setOnlineFalse);
    return () => {
      window.removeEventListener('online', setOnlineTrue);
      window.removeEventListener('offline', setOnlineFalse);
    };
  }, []);

  return { online };
}
