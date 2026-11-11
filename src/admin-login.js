const API_URL = "https://pk-booste.onrender.com";

if (localStorage.getItem("pkBoosterAdminToken")) {
  window.location.href = "./admin.html";
}

const form = document.getElementById("adminLoginForm");
const button = document.getElementById("loginButton");
const message = document.getElementById("loginMessage");

function showMessage(text, type = "error") {
  message.textContent = text;
  message.className =
    `text-sm rounded-xl px-4 py-3 ${
      type === "success"
        ? "bg-green-50 text-green-700"
        : "bg-red-50 text-red-700"
    }`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  button.disabled = true;
  button.textContent = "Signing in...";
  message.className = "hidden";

  try {
    const response = await fetch(`${API_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("password").value
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || "Unable to sign in.");
    }

    localStorage.setItem("pkBoosterAdminToken", data.token);
    localStorage.setItem("pkBoosterAdmin", JSON.stringify(data.admin));

    window.location.href = "./admin.html";
  } catch (error) {
    showMessage(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
});
