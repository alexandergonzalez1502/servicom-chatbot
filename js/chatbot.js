/**
 * Chatbot de autogestión B2B — Servicom Global
 * Máquina de estados + SupabaseAPI + UI modular (window.Chatbot)
 */
(function () {
  "use strict";

  const STATE = {
    INICIO: "INICIO",
    LOGIN: "LOGIN",
    MENU: "MENU",
    SALDO: "SALDO",
    FACTURAS: "FACTURAS",
    PAGO_PASO1: "PAGO_PASO1",
    PAGO_PASO2: "PAGO_PASO2",
    PAGO_PASO3: "PAGO_PASO3",
    PAGO_PASO4: "PAGO_PASO4",
    PAGO_CONFIRMAR: "PAGO_CONFIRMAR",
    PAGO_EXITO: "PAGO_EXITO",
    AGENTE: "AGENTE",
  };

  const CUIT_REGEX = /^\d{2}-\d{8}-\d{1}$/;
  const MAX_LOGIN_ATTEMPTS = 3;
  const LOCK_MS = 10 * 60 * 1000;
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const ALLOWED_FILE_TYPES = [
    "application/pdf",
    "image/jpeg",
    "image/png",
  ];
  const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];
  const LOCK_STORAGE_KEY = "sg_chatbot_lock_until";

  const BRAND = {
    greeting:
      "¡Hola! Soy el asistente de cobranzas de Servicom Global. Para consultar su cuenta, por favor inicie sesión.",
  };

  const DEMO_FACTURAS = [
    {
      numero_factura: "FAC-2026-0412",
      fecha: "2026-04-01",
      importe: 4200,
      dias_vencimiento: -5,
      estado: "vencida",
    },
    {
      numero_factura: "FAC-2026-0389",
      fecha: "2026-03-15",
      importe: 8250,
      dias_vencimiento: 12,
      estado: "vigente",
    },
  ];

  const DEMO_SALDO = {
    nombre_empresa: "Empresa Demo S.A.",
    saldo_pendiente: 12450,
    limite_credito: 50000,
    facturas_vencidas: 1,
  };

  const toggleBtn = document.getElementById("chatbot-toggle");
  const closeBtn = document.getElementById("chatbot-close");
  const panel = document.getElementById("chatbot-panel");
  const widget = document.getElementById("chatbot-widget");
  const messagesEl = document.getElementById("chatbot-messages");
  const quickButtonsEl = document.getElementById("chatbot-quick-buttons");
  const form = document.getElementById("chatbot-form");
  const input = document.getElementById("chatbot-input");
  const footer = document.querySelector(".chatbot-footer");
  const fileInput = document.getElementById("chatbot-file-input");

  let isOpen = false;
  let hasStarted = false;
  let state = STATE.INICIO;

  const session = {
    usuario: null,
    loginAttempts: 0,
    lockedUntil: null,
    facturasCache: [],
    pago: {
      numeroFactura: null,
      importe: null,
      numeroTransferencia: null,
      archivo: null,
    },
  };

  const supabaseReady =
    typeof window.SupabaseAPI !== "undefined" && window.SupabaseAPI.isConfigured();

  // ─── Utilidades ───────────────────────────────────────────────

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function formatMoney(value) {
    const num = Number(value);
    if (Number.isNaN(num)) return String(value);
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 2,
    }).format(num);
  }

  function formatDate(dateStr) {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("es-AR");
  }

  function normalizeCuit(value) {
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 11) return null;
    return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
  }

  function isAgentKeyword(text) {
    const t = text.toLowerCase();
    return (
      t.includes("agente") ||
      t.includes("asesor") ||
      t.includes("persona")
    );
  }

  function loadLockFromStorage() {
    const stored = localStorage.getItem(LOCK_STORAGE_KEY);
    if (stored) {
      const until = parseInt(stored, 10);
      if (until > Date.now()) {
        session.lockedUntil = until;
      } else {
        localStorage.removeItem(LOCK_STORAGE_KEY);
      }
    }
  }

  function isLocked() {
    if (session.lockedUntil && Date.now() < session.lockedUntil) {
      return true;
    }
    if (session.lockedUntil && Date.now() >= session.lockedUntil) {
      session.lockedUntil = null;
      session.loginAttempts = 0;
      localStorage.removeItem(LOCK_STORAGE_KEY);
    }
    return false;
  }

  function lockAccount() {
    session.lockedUntil = Date.now() + LOCK_MS;
    localStorage.setItem(LOCK_STORAGE_KEY, String(session.lockedUntil));
  }

  function getLockMinutesLeft() {
    return Math.ceil((session.lockedUntil - Date.now()) / 60000);
  }

  function setFooterEnabled(enabled) {
    footer.classList.toggle("chatbot-footer--disabled", !enabled);
    input.disabled = !enabled;
  }

  function resetPago() {
    session.pago = {
      numeroFactura: null,
      importe: null,
      numeroTransferencia: null,
      archivo: null,
    };
    if (fileInput) fileInput.value = "";
  }

  function isLoggedIn() {
    return Boolean(session.usuario);
  }

  // ─── UI modular ───────────────────────────────────────────────

  function addBotMessage(text) {
    const row = document.createElement("div");
    row.className = "chatbot-row chatbot-row--bot";
    const bubble = document.createElement("div");
    bubble.className = "chatbot-bubble chatbot-bubble--bot";
    bubble.textContent = text;
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();
    return bubble;
  }

  function addUserMessage(text) {
    const row = document.createElement("div");
    row.className = "chatbot-row chatbot-row--user";
    const bubble = document.createElement("div");
    bubble.className = "chatbot-bubble chatbot-bubble--user";
    bubble.textContent = text;
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();
    return bubble;
  }

  function addErrorMessage(text) {
    const row = document.createElement("div");
    row.className = "chatbot-row chatbot-row--bot chatbot-message--error";
    const bubble = document.createElement("div");
    bubble.className = "chatbot-bubble chatbot-bubble--bot";
    bubble.textContent = text;
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();
    return bubble;
  }

  function addCard(html, extraClass = "") {
    const card = document.createElement("div");
    card.className = `chatbot-card${extraClass ? ` ${extraClass}` : ""}`;
    card.innerHTML = html;
    messagesEl.appendChild(card);
    scrollToBottom();
    return card;
  }

  function clearQuickButtons() {
    quickButtonsEl.innerHTML = "";
  }

  function addQuickButtons(options, callback, append = false) {
    if (!append) clearQuickButtons();
    options.forEach((label) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chatbot-quick-btn";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        clearQuickButtons();
        if (typeof callback === "function") callback(label);
      });
      quickButtonsEl.appendChild(btn);
    });
  }

  function removeInteractiveWidgets() {
    messagesEl
      .querySelectorAll(".chatbot-login-form, .chatbot-upload-zone")
      .forEach((el) => el.remove());
  }

  function addLoginForm() {
    removeInteractiveWidgets();

    const formEl = document.createElement("form");
    formEl.className = "chatbot-login-form";
    formEl.innerHTML = `
      <label>
        CUIT
        <input type="text" id="chatbot-cuit" placeholder="20-12345678-9" autocomplete="username" maxlength="13" />
      </label>
      <label>
        Contraseña
        <input type="password" id="chatbot-password" placeholder="Su contraseña" autocomplete="current-password" />
      </label>
      <button type="submit" class="chatbot-login-submit">Ingresar</button>
    `;

    formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      handleLoginSubmit(
        formEl.querySelector("#chatbot-cuit").value.trim(),
        formEl.querySelector("#chatbot-password").value
      );
    });

    messagesEl.appendChild(formEl);
    scrollToBottom();
    setFooterEnabled(false);
    formEl.querySelector("#chatbot-cuit").focus();
    return formEl;
  }

  function addUploadZone(onFileSelected) {
    removeInteractiveWidgets();

    const zone = document.createElement("div");
    zone.className = "chatbot-upload-zone";
    zone.innerHTML = `
      <strong>Adjuntar comprobante</strong>
      <p>PDF, JPG o PNG — máximo 5 MB</p>
      <p class="chatbot-upload-name" id="chatbot-upload-filename"></p>
    `;

    const showName = (name) => {
      zone.querySelector("#chatbot-upload-filename").textContent = name
        ? `Archivo: ${name}`
        : "";
    };

    zone.addEventListener("click", () => fileInput.click());

    fileInput.onchange = () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      const validation = validateFile(file);
      if (!validation.ok) {
        addErrorMessage(validation.error);
        fileInput.value = "";
        showName("");
        return;
      }

      session.pago.archivo = file;
      showName(file.name);
      if (typeof onFileSelected === "function") onFileSelected(file);
    };

    messagesEl.appendChild(zone);
    scrollToBottom();
    setFooterEnabled(false);
    return zone;
  }

  function validateFile(file) {
    const ext = file.name.includes(".")
      ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
      : "";

    if (
      !ALLOWED_FILE_TYPES.includes(file.type) &&
      !ALLOWED_EXTENSIONS.includes(ext)
    ) {
      return {
        ok: false,
        error: "Formato no permitido. Use PDF, JPG o PNG.",
      };
    }

    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        error: "El archivo supera el máximo de 5 MB.",
      };
    }

    return { ok: true };
  }

  // ─── Supabase / demo ──────────────────────────────────────────

  async function apiLogin(cuit, password) {
    if (supabaseReady) {
      return window.SupabaseAPI.loginUsuario(cuit, password);
    }
    await delay(400);
    if (cuit === "20-12345678-9" && password === "demo123") {
      return {
        id: "demo-1",
        cuit,
        nombre_empresa: "Empresa Demo S.A.",
      };
    }
    return null;
  }

  async function apiGetSaldo(usuarioId) {
    if (supabaseReady) {
      return window.SupabaseAPI.getSaldoCuenta(usuarioId);
    }
    await delay(300);
    return { ...DEMO_SALDO };
  }

  async function apiGetFacturas(usuarioId) {
    if (supabaseReady) {
      return window.SupabaseAPI.getFacturas(usuarioId);
    }
    await delay(300);
    return [...DEMO_FACTURAS];
  }

  async function apiRegistrarPago(datos) {
    if (supabaseReady) {
      return window.SupabaseAPI.registrarAvisoPago(
        datos.usuarioId,
        datos.numeroFactura,
        datos.importe,
        datos.numeroTransferencia,
        datos.comprobanteUrl
      );
    }
    await delay(500);
    return `PAG-${String(Math.floor(1000 + Math.random() * 9000))}`;
  }

  async function apiSubirComprobante(archivo, referencia) {
    if (supabaseReady) {
      return window.SupabaseAPI.subirComprobante(archivo, referencia);
    }
    await delay(500);
    return `https://demo.servicomglobal.com/comprobantes/${referencia}`;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isFacturaVencida(f) {
    if (f.estado === "vencida") return true;
    if (typeof f.dias_vencimiento === "number" && f.dias_vencimiento < 0) {
      return true;
    }
    return false;
  }

  // ─── FAQ (sin login) ──────────────────────────────────────────

  function handleFaq(message) {
    const t = message.toLowerCase();

    if (t.includes("plazo") || t.includes("vencimiento")) {
      addBotMessage(
        "Los plazos de pago estándar son: contado (0 días), 30, 60 y 90 días según su condición comercial. Las facturas vencidas generan intereses punitorios del 2% mensual."
      );
      return true;
    }

    if (
      t.includes("banco") ||
      t.includes("transferencia") ||
      t.includes("cbu")
    ) {
      addCard(`
        <div class="chatbot-card-header">Datos bancarios</div>
        <div class="chatbot-card-body">
          <p><strong>Banco:</strong> Banco Demo S.A.</p>
          <p><strong>CBU:</strong> 0720123456789012345678</p>
          <p><strong>Alias:</strong> SERVICOM.GLOBAL.DEMO</p>
          <p><strong>Titular:</strong> Servicom Global S.A.</p>
          <p><strong>CUIT:</strong> 30-71234567-8</p>
        </div>
      `);
      return true;
    }

    if (t.includes("horario")) {
      addBotMessage(
        "Nuestro horario de atención es de lunes a viernes de 9:00 a 18:00 hs."
      );
      return true;
    }

    addBotMessage(
      "Para acceder a su cuenta, saldos y facturas, por favor inicie sesión con su CUIT y contraseña."
    );
    return true;
  }

  // ─── Estados ──────────────────────────────────────────────────

  function goTo(newState) {
    state = newState;
    clearQuickButtons();
    removeInteractiveWidgets();
  }

  function startInicio() {
    goTo(STATE.INICIO);
    addBotMessage(BRAND.greeting);
    goToLogin();
  }

  function goToLogin() {
    goTo(STATE.LOGIN);

    if (isLocked()) {
      addErrorMessage(
        `Demasiados intentos fallidos. Intente nuevamente en ${getLockMinutesLeft()} minutos.`
      );
      setFooterEnabled(false);
      return;
    }

    addBotMessage("Ingrese su CUIT y contraseña para continuar:");
    addLoginForm();
  }

  async function handleLoginSubmit(cuitRaw, password) {
    if (isLocked()) {
      addErrorMessage(
        `Cuenta bloqueada. Espere ${getLockMinutesLeft()} minutos.`
      );
      return;
    }

    const cuitInput = document.getElementById("chatbot-cuit");
    const cuit = normalizeCuit(cuitRaw);

    if (!cuit || !CUIT_REGEX.test(cuit)) {
      addErrorMessage("CUIT inválido. Use el formato XX-XXXXXXXX-X (ej: 20-12345678-9).");
      if (cuitInput) cuitInput.classList.add("input-error");
      return;
    }

    if (cuitInput) cuitInput.classList.remove("input-error");

    if (!password) {
      addErrorMessage("Ingrese su contraseña.");
      return;
    }

    const submitBtn = document.querySelector(".chatbot-login-submit");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Verificando...";
    }

    try {
      const usuario = await apiLogin(cuit, password);

      if (!usuario) {
        session.loginAttempts += 1;
        addErrorMessage("CUIT o contraseña incorrectos");

        if (session.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
          lockAccount();
          removeInteractiveWidgets();
          addErrorMessage(
            `Ha superado el máximo de intentos. Su acceso está bloqueado por 10 minutos.`
          );
          setFooterEnabled(false);
          return;
        }

        addBotMessage(
          `Intento ${session.loginAttempts} de ${MAX_LOGIN_ATTEMPTS}. Verifique sus datos e intente nuevamente.`
        );
        return;
      }

      session.usuario = usuario;
      session.loginAttempts = 0;
      session.lockedUntil = null;
      localStorage.removeItem(LOCK_STORAGE_KEY);
      removeInteractiveWidgets();
      setFooterEnabled(true);
      goToMenu();
    } catch (err) {
      console.error(err);
      addErrorMessage("Error de conexión. Intente nuevamente en unos momentos.");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Ingresar";
      }
    }
  }

  function goToMenu() {
    goTo(STATE.MENU);
    const nombre =
      session.usuario?.nombre_empresa || session.usuario?.nombre || "cliente";
    addBotMessage(`¡Bienvenido, ${nombre}! ¿En qué puedo ayudarle?`);
    setFooterEnabled(true);
    input.placeholder = "Escriba su mensaje...";

    addQuickButtons(
      [
        "Consultar saldo",
        "Ver facturas",
        "Informar un pago",
        "Hablar con un asesor",
      ],
      handleMenuAction
    );
  }

  function handleMenuAction(label) {
    addUserMessage(label);

    if (isAgentKeyword(label)) {
      goToAgente();
      return;
    }

    switch (label) {
      case "Consultar saldo":
        goToSaldo();
        break;
      case "Ver facturas":
        goToFacturas();
        break;
      case "Informar un pago":
        goToPagoPaso1();
        break;
      case "Hablar con un asesor":
        goToAgente();
        break;
      default:
        goToMenu();
    }
  }

  async function goToSaldo() {
    goTo(STATE.SALDO);
    addBotMessage("Consultando su cuenta corriente...");

    try {
      const data = await apiGetSaldo(session.usuario.id);
      const saldo = Number(data.saldo_pendiente) || 0;
      const limite = Number(data.limite_credito) || 0;
      const disponible = Math.max(0, limite - saldo);
      const vencidas = Number(data.facturas_vencidas) || 0;

      let alertHtml = "";
      if (vencidas > 0) {
        alertHtml = `
          <div class="chatbot-card chatbot-card--alert" style="margin-top:0.5rem">
            <div class="chatbot-card-header">⚠ Atención</div>
            <div class="chatbot-card-body">
              <p>Tiene <strong>${vencidas}</strong> factura(s) vencida(s). Le recomendamos regularizar su situación.</p>
            </div>
          </div>
        `;
      }

      addCard(`
        <div class="chatbot-card-header">Cuenta corriente</div>
        <div class="chatbot-card-body">
          <p><strong>Empresa:</strong> ${data.nombre_empresa ?? "—"}</p>
          <p><strong>Saldo pendiente:</strong> ${formatMoney(saldo)}</p>
          <p><strong>Límite de crédito:</strong> ${formatMoney(limite)}</p>
          <p><strong>Crédito disponible:</strong> ${formatMoney(disponible)}</p>
        </div>
        ${alertHtml}
      `);

      addQuickButtons(
        ["Ver facturas", "Informar un pago", "Volver al menú"],
        (lbl) => {
          addUserMessage(lbl);
          if (lbl === "Ver facturas") goToFacturas();
          else if (lbl === "Informar un pago") goToPagoPaso1();
          else goToMenu();
        }
      );
    } catch (err) {
      console.error(err);
      addBotMessage("No pudimos obtener su saldo. Intente nuevamente.");
      addQuickButtons(["Volver al menú"], () => {
        addUserMessage("Volver al menú");
        goToMenu();
      });
    }
  }

  async function goToFacturas() {
    goTo(STATE.FACTURAS);
    addBotMessage("Cargando sus facturas...");

    try {
      const facturas = await apiGetFacturas(session.usuario.id);
      session.facturasCache = facturas;

      if (!facturas.length) {
        addBotMessage("No tiene facturas registradas en este momento.");
        addQuickButtons(["Volver al menú"], () => {
          addUserMessage("Volver al menú");
          goToMenu();
        });
        return;
      }

      const filas = facturas
        .map((f) => {
          const numero = f.numero_factura ?? f.id;
          const vencida = isFacturaVencida(f);
          const badgeClass = vencida
            ? "chatbot-badge--vencida"
            : "chatbot-badge--vigente";
          const badgeText = vencida ? "Vencida" : "Vigente";

          return `
            <div class="chatbot-factura-row" data-factura="${numero}">
              <div class="chatbot-factura-info">
                <p><strong>${numero}</strong>
                  <span class="chatbot-badge ${badgeClass}">${badgeText}</span>
                </p>
                <p>Fecha: ${formatDate(f.fecha)} · ${formatMoney(f.importe ?? f.monto)}</p>
              </div>
              <div class="chatbot-factura-actions">
                <button type="button" class="chatbot-btn-sm chatbot-btn-descargar" data-num="${numero}">
                  Descargar PDF
                </button>
              </div>
            </div>
          `;
        })
        .join("");

      const card = addCard(`
        <div class="chatbot-card-header">Facturas</div>
        <div class="chatbot-card-body">${filas}</div>
      `);

      card.querySelectorAll(".chatbot-btn-descargar").forEach((btn) => {
        btn.addEventListener("click", () => {
          addUserMessage(`Descargar ${btn.dataset.num}`);
          addBotMessage("Funcionalidad próximamente disponible");
        });
      });

      addQuickButtons(
        ["Informar un pago", "Volver al menú"],
        (lbl) => {
          addUserMessage(lbl);
          if (lbl === "Informar un pago") goToPagoPaso1();
          else goToMenu();
        }
      );
    } catch (err) {
      console.error(err);
      addBotMessage("No pudimos cargar sus facturas.");
      addQuickButtons(["Volver al menú"], () => {
        addUserMessage("Volver al menú");
        goToMenu();
      });
    }
  }

  async function goToPagoPaso1() {
    goTo(STATE.PAGO_PASO1);
    resetPago();
    addBotMessage("¿A qué factura corresponde el pago? Seleccione una opción:");
    setFooterEnabled(false);

    try {
      const facturas =
        session.facturasCache.length > 0
          ? session.facturasCache
          : await apiGetFacturas(session.usuario.id);

      session.facturasCache = facturas;

      if (!facturas.length) {
        addBotMessage("No hay facturas disponibles para informar un pago.");
        setFooterEnabled(true);
        goToMenu();
        return;
      }

      const labels = facturas.map(
        (f) =>
          `${f.numero_factura ?? f.id} (${formatMoney(f.importe ?? f.monto)})`
      );

      addQuickButtons([...labels, "Cancelar"], (label) => {
        addUserMessage(label);
        if (label === "Cancelar") {
          resetPago();
          setFooterEnabled(true);
          goToMenu();
          return;
        }
        const numero = label.split(" (")[0];
        session.pago.numeroFactura = numero;
        goToPagoPaso2();
      });
    } catch (err) {
      console.error(err);
      addBotMessage("Error al cargar facturas.");
      setFooterEnabled(true);
      goToMenu();
    }
  }

  function goToPagoPaso2() {
    goTo(STATE.PAGO_PASO2);
    setFooterEnabled(true);
    input.placeholder = "Ej: 15000.50";
    addBotMessage(
      `Factura ${session.pago.numeroFactura} seleccionada. Ingrese el importe de la transferencia:`
    );
  }

  function goToPagoPaso3() {
    goTo(STATE.PAGO_PASO3);
    input.placeholder = "Nº de transferencia o CBU origen";
    addBotMessage("Ingrese el número de transferencia o CBU desde el cual realizó el pago:");
  }

  function goToPagoPaso4() {
    goTo(STATE.PAGO_PASO4);
    addBotMessage("Adjunte el comprobante de pago (PDF, JPG o PNG, máximo 5 MB):");
    addUploadZone(() => {
      goToPagoConfirmar();
    });
  }

  function goToPagoConfirmar() {
    goTo(STATE.PAGO_CONFIRMAR);
    setFooterEnabled(true);
    input.placeholder = "Escriba su mensaje...";

    addCard(`
      <div class="chatbot-card-header">Resumen del aviso de pago</div>
      <div class="chatbot-card-body">
        <p><strong>Factura:</strong> ${session.pago.numeroFactura}</p>
        <p><strong>Importe:</strong> ${formatMoney(session.pago.importe)}</p>
        <p><strong>Transferencia/CBU:</strong> ${session.pago.numeroTransferencia}</p>
        <p><strong>Comprobante:</strong> ${session.pago.archivo?.name ?? "—"}</p>
      </div>
    `);

    addBotMessage("¿Los datos son correctos? Confirme para registrar el aviso de pago.");
    addQuickButtons(["Confirmar pago", "Cancelar"], async (lbl) => {
      addUserMessage(lbl);
      if (lbl === "Cancelar") {
        resetPago();
        goToMenu();
        return;
      }
      await confirmarPago();
    });
  }

  async function confirmarPago() {
    addBotMessage("Procesando su aviso de pago...");
    clearQuickButtons();
    setFooterEnabled(false);

    try {
      const referencia = await apiRegistrarPago({
        usuarioId: session.usuario.id,
        numeroFactura: session.pago.numeroFactura,
        importe: session.pago.importe,
        numeroTransferencia: session.pago.numeroTransferencia,
        comprobanteUrl: null,
      });

      if (session.pago.archivo) {
        await apiSubirComprobante(session.pago.archivo, referencia);
      }

      goToPagoExito(referencia);
    } catch (err) {
      console.error(err);
      addErrorMessage(
        "No pudimos registrar el aviso de pago. Intente nuevamente o contacte a un asesor."
      );
      setFooterEnabled(true);
      addQuickButtons(["Reintentar", "Hablar con un asesor"], (lbl) => {
        addUserMessage(lbl);
        if (lbl === "Reintentar") goToPagoConfirmar();
        else goToAgente();
      });
    }
  }

  function goToPagoExito(referencia) {
    goTo(STATE.PAGO_EXITO);
    resetPago();
    setFooterEnabled(true);

    addCard(
      `
      <div class="chatbot-card-header">✓ Pago registrado</div>
      <div class="chatbot-card-body">
        <p>Su aviso de pago fue registrado correctamente.</p>
        <p><strong>Número de referencia:</strong> ${referencia}</p>
        <p>Consérvelo para el seguimiento de su gestión. Un analista verificará el comprobante en las próximas 24 hs hábiles.</p>
      </div>
    `,
      "chatbot-card--success"
    );

    addQuickButtons(["Volver al menú"], () => {
      addUserMessage("Volver al menú");
      goToMenu();
    });
  }

  function goToAgente() {
    goTo(STATE.AGENTE);
    setFooterEnabled(true);

    const ticket = `TKT-${String(Math.floor(1000 + Math.random() * 9000))}`;

    addCard(
      `
      <div class="chatbot-card-header">Derivación a asesor</div>
      <div class="chatbot-card-body">
        <p>Su consulta fue derivada a un asesor de cobranzas.</p>
        <p><strong>Número de ticket:</strong> ${ticket}</p>
        <p>Un representante se comunicará con usted a la brevedad.</p>
        <p><strong>Horario de atención:</strong> Lunes a Viernes de 9:00 a 18:00 hs.</p>
      </div>
    `,
      "chatbot-card--agent"
    );

    if (isLoggedIn()) {
      addQuickButtons(["Volver al menú"], () => {
        addUserMessage("Volver al menú");
        goToMenu();
      });
    } else {
      addQuickButtons(["Iniciar sesión"], () => {
        addUserMessage("Iniciar sesión");
        goToLogin();
      });
    }
  }

  // ─── Entrada de texto ─────────────────────────────────────────

  function parseImporte(value) {
    const cleaned = value.replace(/[^\d.,]/g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    return Number.isFinite(num) && num > 0 ? num : null;
  }

  async function handleTextInput(message) {
    if (isAgentKeyword(message)) {
      if (!isLoggedIn()) addUserMessage(message);
      goToAgente();
      return;
    }

    if (!isLoggedIn()) {
      if (state === STATE.INICIO || state === STATE.LOGIN) {
        addUserMessage(message);
        handleFaq(message);
        return;
      }
    }

    switch (state) {
      case STATE.LOGIN:
        handleFaq(message);
        break;

      case STATE.MENU:
        addUserMessage(message);
        routeMenuKeyword(message);
        break;

      case STATE.SALDO:
      case STATE.FACTURAS:
      case STATE.PAGO_EXITO:
      case STATE.AGENTE:
        addUserMessage(message);
        routeMenuKeyword(message);
        break;

      case STATE.PAGO_PASO2: {
        addUserMessage(message);
        const importe = parseImporte(message);
        if (!importe) {
          addErrorMessage("Ingrese un importe válido (ej: 15000 o 15000,50).");
          return;
        }
        session.pago.importe = importe;
        goToPagoPaso3();
        break;
      }

      case STATE.PAGO_PASO3: {
        addUserMessage(message);
        if (message.length < 5) {
          addErrorMessage("Ingrese un número de transferencia o CBU válido.");
          return;
        }
        session.pago.numeroTransferencia = message;
        goToPagoPaso4();
        break;
      }

      case STATE.PAGO_PASO4:
        addUserMessage(message);
        addBotMessage("Utilice la zona de carga para adjuntar su comprobante, o haga clic en el área punteada.");
        break;

      case STATE.PAGO_CONFIRMAR:
        addUserMessage(message);
        if (
          message.toLowerCase().includes("confirm") ||
          message.toLowerCase() === "si" ||
          message.toLowerCase() === "sí"
        ) {
          await confirmarPago();
        } else if (message.toLowerCase().includes("cancel")) {
          resetPago();
          goToMenu();
        } else {
          addBotMessage('Escriba "Confirmar" o use el botón "Confirmar pago".');
        }
        break;

      default:
        addUserMessage(message);
        if (isLoggedIn()) goToMenu();
        else handleFaq(message);
    }
  }

  function routeMenuKeyword(message) {
    const t = message.toLowerCase();

    if (t.includes("saldo") || t.includes("cuenta")) {
      goToSaldo();
    } else if (t.includes("factura")) {
      goToFacturas();
    } else if (t.includes("pago") || t.includes("pagar") || t.includes("informar")) {
      goToPagoPaso1();
    } else if (isAgentKeyword(message)) {
      goToAgente();
    } else if (t.includes("menu") || t.includes("menú") || t.includes("volver")) {
      goToMenu();
    } else {
      addBotMessage("Seleccione una opción del menú o escriba: saldo, facturas, pago o asesor.");
      if (state === STATE.MENU) {
        addQuickButtons(
          [
            "Consultar saldo",
            "Ver facturas",
            "Informar un pago",
            "Hablar con un asesor",
          ],
          handleMenuAction
        );
      }
    }
  }

  // ─── Inicio del widget ────────────────────────────────────────

  function startConversation() {
    loadLockFromStorage();
    messagesEl.innerHTML = "";
    startInicio();
  }

  function setPanelOpen(open) {
    isOpen = open;
    panel.hidden = !open;
    toggleBtn.setAttribute("aria-expanded", String(open));
    widget.classList.toggle("chatbot-widget--open", open);

    if (open) {
      if (!hasStarted) {
        startConversation();
        hasStarted = true;
      }
      if (state !== STATE.LOGIN || isLoggedIn()) {
        input.focus();
      }
    }
  }

  toggleBtn.addEventListener("click", () => setPanelOpen(!isOpen));
  closeBtn.addEventListener("click", () => setPanelOpen(false));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    handleTextInput(message);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) setPanelOpen(false);
  });

  window.Chatbot = {
    addBotMessage,
    addUserMessage,
    addQuickButtons,
    addCard,
    clearQuickButtons,
    addErrorMessage,
    goToMenu,
    goToAgente,
    getState: () => state,
    open: () => setPanelOpen(true),
    close: () => setPanelOpen(false),
  };
})();
