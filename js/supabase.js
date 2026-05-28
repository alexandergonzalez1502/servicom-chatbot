(function () {
  "use strict";

  const SUPABASE_URL = 'https://mtnzjerhdarlzkwxaxee.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10bnpqZXJoZGFybHprd3hheGVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5MTIyNTYsImV4cCI6MjA5NTQ4ODI1Nn0.6-3-0d_SrwOcdKfA2TAQ5nH6NKW6BN2lGsTqBJ5b27A';

  let client = null;

  function getClient() {
    if (!client) {
      // Intentamos inicializar el cliente y atrapar si falla porque no se cargó el script principal
      try {
        client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      } catch (error) {
        console.error("Error crítico: No se pudo inicializar Supabase. ¿Olvidaste cargar el script de Supabase en el HTML?", error);
      }
    }
    return client;
  }

  async function loginUsuario(cuit, password) {
    console.log("1. Intentando login con CUIT:", cuit);
    try {
      const { data, error } = await getClient()
        .from('usuarios')
        .select('*')
        .eq('cuit', cuit)
        .eq('password', password)
        .single();
      
      console.log("2. Respuesta de Supabase (Login):", { data, error });
      
      if (error) {
        console.error("3. Error detectado por Supabase al iniciar sesión:", error);
        return null;
      }
      return data;
    } catch (excepcion) {
      console.error("4. Error catastrófico en JS (Login):", excepcion);
      return null;
    }
  }

  async function getSaldoCuenta(usuarioId) {
    try {
      const { data, error } = await getClient()
        .from('usuarios')
        .select('*')
        .eq('id', usuarioId)
        .single();
        
      if (error) {
        console.error("Error al obtener saldo:", error);
        return null;
      }
      return data;
    } catch (excepcion) {
      console.error("Error JS en getSaldoCuenta:", excepcion);
      return null;
    }
  }

  async function getFacturas(usuarioId) {
    try {
      const { data, error } = await getClient()
        .from('facturas')
        .select('*')
        .eq('usuario_id', usuarioId)
        .order('dias_vencimiento', { ascending: true });
        
      if (error) {
        console.error("Error al obtener facturas:", error);
        return [];
      }
      return data;
    } catch (excepcion) {
      console.error("Error JS en getFacturas:", excepcion);
      return [];
    }
  }

  async function registrarAvisoPago(usuarioId, numeroFactura, importe, numeroTransferencia, comprobanteUrl) {
    try {
      const referencia = 'PAG-' + Math.floor(1000 + Math.random() * 9000);
      const { data, error } = await getClient()
        .from('avisos_pago')
        .insert([{
          usuario_id: usuarioId,
          numero_factura: numeroFactura,
          importe: importe,
          numero_transferencia: numeroTransferencia,
          referencia: referencia,
          estado: 'Pendiente de verificación',
          fecha_registro: new Date().toISOString(),
          comprobante_url: comprobanteUrl || ''
        }]);
        
      if (error) {
        console.error("Error al registrar aviso de pago:", error);
        return null;
      }
      return referencia;
    } catch (excepcion) {
      console.error("Error JS en registrarAvisoPago:", excepcion);
      return null;
    }
  }

  async function subirComprobante(archivo, referencia) {
    try {
      const extension = archivo.name.split('.').pop();
      const nombre = referencia + '.' + extension;
      const { data, error } = await getClient()
        .storage
        .from('comprobantes')
        .upload(nombre, archivo, { upsert: true });
        
      if (error) {
        console.error("Error al subir comprobante:", error);
        return '';
      }
      
      const { data: urlData } = getClient()
        .storage
        .from('comprobantes')
        .getPublicUrl(nombre);
        
      return urlData.publicUrl;
    } catch (excepcion) {
      console.error("Error JS en subirComprobante:", excepcion);
      return '';
    }
  }

  window.SupabaseService = {
    loginUsuario,
    getSaldoCuenta,
    getFacturas,
    registrarAvisoPago,
    subirComprobante
  };
})();
