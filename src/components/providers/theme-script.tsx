/**
 * Inline pre-paint theme script (FOUC prevention).
 *
 * Deliberately rendered from the SERVER component tree: React 19 / Next 16
 * reject `<script>` elements created during a client render ("Encountered a
 * script tag while rendering React component") - which is exactly what
 * `next-themes` 0.4.6 did from inside its client provider. As long as this
 * script only ever arrives through the server HTML, React hydrates it (or
 * never re-creates it) and the warning cannot occur.
 *
 * The browser executes it while parsing the HTML, before paint and before
 * hydration, so the correct theme class is already on <html> at first paint.
 * The logic mirrors the client provider below: localStorage stores the
 * explicit `light` / `dark` preference or `system`, and `system` resolves
 * through the OS color-scheme media query.
 */
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t="system";}var dark=t==="system"?window.matchMedia("(prefers-color-scheme: dark)").matches:t==="dark";var root=document.documentElement;root.classList.remove("light","dark");root.classList.add(dark?"dark":"light");root.style.colorScheme=dark?"dark":"light";}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />;
}
