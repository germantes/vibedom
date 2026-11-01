// Copiar fragmentos de la documentación. Sin dependencias y sin red: si el
// portapapeles no está disponible, el botón queda desactivado y el código se
// puede seleccionar a mano.
const buttons = document.querySelectorAll("[data-copy]");

for (const button of buttons) {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copy);
    if (!target) return;

    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(target.textContent.trim());
      button.textContent = button.dataset.copied || original;
    } catch {
      button.textContent = button.dataset.error || original;
    }
    setTimeout(() => {
      button.textContent = original;
    }, 1800);
  });
}
