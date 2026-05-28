(function () {
  "use strict";

  const SUPABASE_URL = 'https://mtnzjerhdarlzkwxaxee.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10bnpqZXJoZGFybHprd3hheGVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5MTIyNTYsImV4cCI6MjA5NTQ4ODI1Nn0.6-3-0d_SrwOcdKfA2TAQ5nH6NKW6BN2lGsTqBJ5b27A';

  let client = null;

  function getClient() {
    if (!client) {
      client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return client;
  }

  async function loginUsuario(cuit, password) {
    const { data, error } = await getClient()
      .from('usuarios')
      .select('*')
      .eq('cuit', cuit)
      .eq('password', password)
      .single();
    if (error) return null;
    return data;
  }

  async function getSaldoCuenta(usuarioId) {
    const { data, error } = await getClient()
      .from('usuarios')
      .select('*')
      .eq('id', usuarioId)
      .single();
    if (error) return null;
    return data;
  }

  async function getFacturas(usuarioId) {
    const { data, error } = await getClient()
      .from('facturas')
      .select('*')
      .eq('usuario_id', usuarioId)
      .order('dias_vencimiento', { ascending: true });
    if (error) return [];
    return data;
  }

  async function registrarAvisoPago(usuarioId, numeroFactura, importe, numeroTransferencia, comprobanteUrl) {
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
    if (error) return null;
    return referencia;
  }

  async function subirComprobante(archivo, referencia) {
    const extension = archivo.name.split('.').pop();
    const nombre = referencia + '.' + extension;
    const { data, error } = await getClient()
      .storage
      .from('comprobantes')
      .upload(nombre, archivo, { upsert: true });
    if (error) return '';
    const { data: urlData } = getClient()
      .storage
      .from('comprobantes')
      .getPublicUrl(nombre);
    return urlData.publicUrl;
  }

  window.SupabaseService = {
    loginUsuario,
    getSaldoCuenta,
    getFacturas,
    registrarAvisoPago,
    subirComprobante
  };
})();
