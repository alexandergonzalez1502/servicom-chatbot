/**
 * Cliente Supabase — Servicom Global
 * Requiere: CDN @supabase/supabase-js@2 y js/env.config.js (generado desde .env)
 */
(function () {
  "use strict";

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  let client = null;

  function getClient() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error(
        "Faltan SUPABASE_URL o SUPABASE_ANON_KEY. Ejecute: node scripts/generate-env.js"
      );
    }
    if (!client) {
      if (!window.supabase?.createClient) {
        throw new Error("Supabase JS no está cargado. Verifique el script CDN.");
      }
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return client;
  }

  function isConfigured() {
    return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  }

  /**
   * @param {string} cuit
   * @param {string} password
   * @returns {Promise<object|null>}
   */
  async function loginUsuario(cuit, password) {
    const supabase = getClient();

    const { data, error } = await supabase
      .from("usuarios")
      .select("*")
      .eq("cuit", cuit)
      .eq("password", password)
      .maybeSingle();

    if (error) {
      console.error("loginUsuario:", error);
      throw error;
    }

    return data;
  }

  /**
   * @param {string|number} usuarioId
   * @returns {Promise<{ saldo_pendiente, limite_credito, facturas_vencidas, nombre_empresa }>}
   */
  async function getSaldoCuenta(usuarioId) {
    const supabase = getClient();

    const { data, error } = await supabase
      .from("usuarios")
      .select("saldo_pendiente, limite_credito, facturas_vencidas, nombre_empresa")
      .eq("id", usuarioId)
      .single();

    if (error) {
      console.error("getSaldoCuenta:", error);
      throw error;
    }

    return data;
  }

  /**
   * @param {string|number} usuarioId
   * @returns {Promise<object[]>}
   */
  async function getFacturas(usuarioId) {
    const supabase = getClient();

    const { data, error } = await supabase
      .from("facturas")
      .select("*")
      .eq("usuario_id", usuarioId)
      .order("dias_vencimiento", { ascending: true });

    if (error) {
      console.error("getFacturas:", error);
      throw error;
    }

    return data ?? [];
  }

  /**
   * @param {string|number} usuarioId
   * @param {string} numeroFactura
   * @param {number} importe
   * @param {string} numeroTransferencia
   * @param {string|null} comprobanteUrl
   * @returns {Promise<string>} referencia PAG-XXXX
   */
  async function registrarAvisoPago(
    usuarioId,
    numeroFactura,
    importe,
    numeroTransferencia,
    comprobanteUrl
  ) {
    const supabase = getClient();
    const referencia = `PAG-${String(Math.floor(1000 + Math.random() * 9000))}`;

    const { error } = await supabase.from("avisos_pago").insert({
      usuario_id: usuarioId,
      numero_factura: numeroFactura,
      importe,
      numero_transferencia: numeroTransferencia,
      comprobante_url: comprobanteUrl,
      referencia,
    });

    if (error) {
      console.error("registrarAvisoPago:", error);
      throw error;
    }

    return referencia;
  }

  /**
   * @param {File} archivo
   * @param {string} referencia
   * @returns {Promise<string>} URL pública del comprobante
   */
  async function subirComprobante(archivo, referencia) {
    const supabase = getClient();
    const extension = archivo.name.includes(".")
      ? archivo.name.slice(archivo.name.lastIndexOf("."))
      : "";
    const fileName = `${referencia}${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("comprobantes")
      .upload(fileName, archivo, { upsert: true });

    if (uploadError) {
      console.error("subirComprobante:", uploadError);
      throw uploadError;
    }

    const { data } = supabase.storage.from("comprobantes").getPublicUrl(fileName);
    return data.publicUrl;
  }

  window.SupabaseAPI = {
    isConfigured,
    getClient,
    loginUsuario,
    getSaldoCuenta,
    getFacturas,
    registrarAvisoPago,
    subirComprobante,
  };
})();
