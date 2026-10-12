import { visibleSocialLinks } from "@/lib/queries";

export default function SocialLinks() {
  const links = visibleSocialLinks();
  if (!links.length) return null;
  return (
    <nav className="social" aria-label="حسابات التواصل الاجتماعي">
      {links.map((l) => (
        <a key={l.key} href={l.url} target="_blank" rel="noopener noreferrer" aria-label={l.label} title={l.label}>
          <svg viewBox="0 0 24 24" width={22} height={22} fill="currentColor" aria-hidden="true">
            <path d={l.path} />
          </svg>
        </a>
      ))}
    </nav>
  );
}
