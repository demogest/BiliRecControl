'use client';

import { ReactNode, useEffect, useState } from 'react';

type Props = {
  roomId: number;
  name: string | null;
  src?: string | null;
  className: string;
  children?: ReactNode;
};

export default function StreamerAvatar({ roomId, name, src, className, children }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = (name?.trim() || String(roomId)).slice(0, 2).toUpperCase();

  useEffect(() => {
    setImageFailed(false);
  }, [src]);

  return (
    <span className={className}>
      {src && !imageFailed ? (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          decoding="async"
          draggable={false}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="avatar-fallback">{initials}</span>
      )}
      {children}
    </span>
  );
}
