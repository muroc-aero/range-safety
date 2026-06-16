/* Idempotent <style> injection, mirroring the design-system primitives'
   self-contained CSS pattern. Each component calls injectStyle(id, css) at
   module load; the id guard means the rules land in <head> exactly once. */
export function injectStyle(id: string, css: string): void {
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = css;
  document.head.appendChild(s);
}
