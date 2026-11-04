import { LOGO_URL } from '../config';

/** Logo della community: un solo punto per sostituire l'immagine (VITE_LOGO_URL). */
export function Logo({ size = 40, className = '' }) {
  return (
    <img
      src={LOGO_URL}
      alt=""
      width={size}
      height={size}
      className={`logo ${className}`.trim()}
      decoding="async"
    />
  );
}
