(function () {
  const symbols = { success: "✓", error: "×", info: "i", warning: "!" };

  function toast(message, type = "info", options = 4200) {
    type = ["success", "error", "info", "warning"].includes(type) ? type : "info";

    // Older pages pass a duration number; newer pages pass { title, duration }.
    const config = typeof options === "number"
      ? { duration: options }
      : (options && typeof options === "object" ? options : {});
    const duration = Number.isFinite(Number(config.duration))
      ? Math.max(0, Number(config.duration))
      : (type === "error" ? 15000 : 6000);

    let container = document.getElementById("pk-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "pk-toast-container";
      container.setAttribute("aria-live", "polite");
      container.setAttribute("aria-relevant", "additions text");
      container.setAttribute("aria-atomic", "false");
      document.body.appendChild(container);
    }

    const item = document.createElement("div");
    item.className = `pk-toast pk-toast-${type}`;
    item.setAttribute("role", type === "error" ? "alert" : "status");

    const icon = document.createElement("span");
    icon.className = "pk-toast-icon";
    icon.textContent = symbols[type];

    const content = document.createElement("div");
    content.className = "pk-toast-content";
    if (config.title) {
      const title = document.createElement("strong");
      title.className = "pk-toast-title";
      title.textContent = String(config.title);
      content.appendChild(title);
    }
    const text = document.createElement("div");
    text.className = "pk-toast-message";
    text.textContent = String(message ?? "");
    content.appendChild(text);

    const close = document.createElement("button");
    close.className = "pk-toast-close";
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "×";
    item.append(icon, content, close);
    container.appendChild(item);

    let timer = null;
    function remove() {
      if (timer) clearTimeout(timer);
      item.style.animation = "pkToastOut .18s ease-in forwards";
      setTimeout(() => item.remove(), 180);
    }
    if (duration > 0) timer = setTimeout(remove, duration);
    close.addEventListener("click", remove);
    return item;
  }

  window.showToast = toast;
  window.toastSuccess = (message, duration) => toast(message, "success", duration ?? 6000);
  window.toastError = (message, duration) => toast(message, "error", duration ?? 15000);
  window.toastInfo = (message, duration) => toast(message, "info", duration ?? 6000);
  window.toastWarning = (message, duration) => toast(message, "warning", duration ?? 9000);
  window.alert = function (message) { toast(message, "error", 15000); };
})();
