// The top bar: the landing's hero, with the spec to resolve.
import {
  ARROW,
  BUTTON,
  DOCS,
  FORM,
  GITHUB,
  HERO,
  INPUT,
  LOGO,
  logo,
  NAV,
  PLACEHOLDER,
  REPO,
  SEARCH,
  SMALL,
} from "./hero.ts";

export function TopBar(props: {
  spec: string;
  setSpec: (spec: string) => void;
  onRun: (spec: string) => void;
}) {
  const { spec } = props;
  return (
    <header className={`${HERO} pb-4`}>
      <nav className={NAV}>
        <a href="/docs" className={DOCS}>
          Docs
        </a>
        <a href={REPO} className={GITHUB}>
          GitHub
        </a>
      </nav>
      <h1 className={`${LOGO} ${SMALL.logo}`}>
        <a href="/" title="upm" dangerouslySetInnerHTML={{ __html: logo }} />
      </h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          props.onRun(spec);
        }}
        className={`${FORM} ${SMALL.form}`}
      >
        <HeroIcon icon={SEARCH} width={2} />
        <input
          autoFocus
          value={spec}
          onChange={(e) => props.setSpec(e.target.value)}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label="Package spec"
          className={INPUT}
        />
        <button title="Resolve (Enter)" className={BUTTON}>
          Explore <HeroIcon icon={ARROW} width={2.25} />
        </button>
      </form>
    </header>
  );
}

function HeroIcon({ icon, width }: { icon: typeof SEARCH; width: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={icon.className}
      dangerouslySetInnerHTML={{ __html: icon.paths }}
    />
  );
}
