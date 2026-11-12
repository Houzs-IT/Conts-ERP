import { Button } from './Button';
import Icon from './Icon';
import { OFFERED_PORTAL_LANGS, LANG_LABEL, setPortalLang, usePortalLang, usePortalText } from '../lib/portalI18n';

export function PortalLanguageSwitch() {
  const t = usePortalText();
  const lang = usePortalLang();
  return (
    /* Hookka's language switch: each language named in its own script. Kept on this phone. */
    <section className="flex flex-col gap-2" aria-label={t.me.language}>
      <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em] flex items-center gap-2"><Icon name="Languages" size="sm" />{t.me.language}</h2>
      <div className="grid grid-cols-2 gap-2">
        {OFFERED_PORTAL_LANGS.map(l => (
          <Button key={l} size="touch" variant={l === lang ? 'primary' : 'secondary'} aria-pressed={l === lang} lang={l} onClick={() => setPortalLang(l)}>
            {LANG_LABEL[l]}
          </Button>
        ))}
      </div>
    </section>
  );
}
