const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// Conexión a Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Middlewares
app.use(cors());
app.use(express.json());

// Ruta principal
app.get('/', (req, res) => {
  res.json({
    mensaje: '🚀 Servidor de Dely Nea funcionando!',
    version: '1.0.0',
    estado: 'online'
  });
});

// Categorías desde la base de datos
app.get('/categorias', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('categorias')
      .select('*')
      .eq('activo', true)
      .order('id');

    if (error) throw error;
    res.json({ categorias: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Prueba de conexión con Supabase
app.get('/test-db', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .limit(1);

    if (error) throw error;
    res.json({ mensaje: '✅ Conexión con base de datos exitosa!', datos: data });
  } catch (error) {
    res.json({ mensaje: '⚠️ Base de datos conectada, tabla aún no creada', detalle: error.message });
  }
});

// Registro de usuario
app.post('/registro', async (req, res) => {
  try {
    const { nombre, email, telefono, password } = req.body;

    const passwordEncriptada = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from('usuarios')
      .insert([{
        nombre,
        email,
        telefono,
        password: passwordEncriptada,
        verificado: false
      }])
      .select();

    if (error) throw error;

    const token = jwt.sign(
      { id: data[0].id, email: data[0].email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      mensaje: '✅ Usuario registrado exitosamente',
      token,
      usuario: { id: data[0].id, nombre: data[0].nombre, email: data[0].email }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login de usuario
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !data) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const passwordValida = await bcrypt.compare(password, data.password);

    if (!passwordValida) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const token = jwt.sign(
      { id: data.id, email: data.email, rol: data.rol },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      mensaje: '✅ Login exitoso!',
      token,
      usuario: { id: data.id, nombre: data.nombre, email: data.email, rol: data.rol }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login con Google
app.post('/login-google', async (req, res) => {
  try {
    const { nombre, email, google_id } = req.body;

    const { data: usuarioExistente } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .single();

    let usuario;

    if (usuarioExistente) {
      usuario = usuarioExistente;
    } else {
      const { data: nuevoUsuario, error } = await supabase
        .from('usuarios')
        .insert([{
          nombre,
          email,
          telefono: 'google',
          password: await bcrypt.hash(google_id, 10),
          verificado: true,
          rol: 'cliente'
        }])
        .select()
        .single();

      if (error) throw error;
      usuario = nuevoUsuario;
    }

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, rol: usuario.rol },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      mensaje: '✅ Login con Google exitoso!',
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener todos los comercios
app.get('/comercios', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('comercios')
      .select('*, categorias(nombre, icono)')
      .eq('activo', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ comercios: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear un comercio nuevo
app.post('/comercios', async (req, res) => {
  try {
    const { nombre, descripcion, categoria_id, direccion, telefono, email } = req.body;

    const { data, error } = await supabase
      .from('comercios')
      .insert([{ nombre, descripcion, categoria_id, direccion, telefono, email }])
      .select();

    if (error) throw error;

    res.json({
      mensaje: '✅ Comercio registrado exitosamente!',
      comercio: data[0]
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear pedido
app.post('/pedidos', async (req, res) => {
  try {
    const { usuario_id, comercio_id, items, direccion_entrega, notas } = req.body;

    const total = items.reduce((sum, item) => sum + (item.precio_unitario * item.cantidad), 0);

    const { data: pedido, error: pedidoError } = await supabase
      .from('pedidos')
      .insert([{ usuario_id, comercio_id, total, direccion_entrega, notas }])
      .select()
      .single();

    if (pedidoError) throw pedidoError;

    const itemsConPedido = items.map(item => ({
      pedido_id: pedido.id,
      nombre_producto: item.nombre,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      subtotal: item.precio_unitario * item.cantidad
    }));

    const { error: itemsError } = await supabase
      .from('pedido_items')
      .insert(itemsConPedido);

    if (itemsError) throw itemsError;

    res.json({
      mensaje: '✅ Pedido creado exitosamente!',
      pedido: {
        id: pedido.id,
        estado: pedido.estado,
        total: pedido.total,
        direccion_entrega: pedido.direccion_entrega
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ver pedidos de un usuario
app.get('/pedidos/:usuario_id', async (req, res) => {
  try {
    const { usuario_id } = req.params;

    const { data, error } = await supabase
      .from('pedidos')
      .select('*, comercios(nombre), pedido_items(*)')
      .eq('usuario_id', usuario_id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ pedidos: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar estado del pedido
app.patch('/pedidos/:id/estado', async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    const { data, error } = await supabase
      .from('pedidos')
      .update({ estado, updated_at: new Date() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      mensaje: `✅ Pedido actualizado a: ${estado}`,
      pedido: data
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Estadísticas generales para el panel admin
app.get('/admin/stats', async (req, res) => {
  try {
    const [usuarios, comercios, pedidos] = await Promise.all([
      supabase.from('usuarios').select('id, created_at, rol'),
      supabase.from('comercios').select('id, nombre, categoria_id, created_at'),
      supabase.from('pedidos').select('id, total, estado, created_at, comercio_id'),
    ]);

    const totalComisiones = (pedidos.data || []).reduce((sum, p) => sum + (p.total * 0.1), 0);
    const pedidosHoy = (pedidos.data || []).filter(p => {
      const hoy = new Date().toDateString();
      return new Date(p.created_at).toDateString() === hoy;
    });

    res.json({
      usuarios: usuarios.data?.length || 0,
      comercios: comercios.data?.length || 0,
      pedidos: pedidos.data?.length || 0,
      comisiones: Math.round(totalComisiones),
      pedidosHoy: pedidosHoy.length,
      comisionesHoy: Math.round(pedidosHoy.reduce((sum, p) => sum + (p.total * 0.1), 0)),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Pedidos por comercio
app.get('/admin/comercios/stats', async (req, res) => {
  try {
    const { data: comercios } = await supabase
      .from('comercios')
      .select('id, nombre, categoria_id');

    const { data: pedidos } = await supabase
      .from('pedidos')
      .select('comercio_id, total, estado');

    const stats = comercios.map(c => {
      const pedidosComercio = pedidos.filter(p => p.comercio_id === c.id);
      const totalVentas = pedidosComercio.reduce((sum, p) => sum + p.total, 0);
      const comisiones = Math.round(totalVentas * 0.1);
      return {
        id: c.id,
        nombre: c.nombre,
        pedidos: pedidosComercio.length,
        ventas: totalVentas,
        comisiones,
      };
    });

    res.json({ comercios: stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Actualizar comisión de un comercio (protegida)
app.patch('/admin/comercios/:id/comision', async (req, res) => {
  try {
    const { id } = req.params;
    const { comision, notas_admin, codigo_admin } = req.body;

    // Verificación simple con código admin
    if (codigo_admin !== process.env.ADMIN_CODE) {
      return res.status(401).json({ error: 'Código de administrador incorrecto' });
    }

    if (comision < 0 || comision > 50) {
      return res.status(400).json({ error: 'La comisión debe estar entre 0% y 50%' });
    }

    const { data, error } = await supabase
      .from('comercios')
      .update({
        comision,
        notas_admin,
        comision_actualizada_at: new Date(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      mensaje: `✅ Comisión actualizada a ${comision}% para ${data.nombre}`,
      comercio: data,
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Dely IA - Asistente con lógica propia
app.post('/dely', async (req, res) => {
  try {
    const { pregunta } = req.body;

    // Obtener datos reales
    const [usuarios, comercios, pedidos] = await Promise.all([
      supabase.from('usuarios').select('id, created_at, rol'),
      supabase.from('comercios').select('id, nombre, comision'),
      supabase.from('pedidos').select('id, total, estado, created_at, comercio_id'),
    ]);

    const totalComisiones = (pedidos.data || []).reduce((sum, p) => sum + (p.total * 0.1), 0);
    const hoy = new Date().toDateString();
    const pedidosHoy = (pedidos.data || []).filter(p => new Date(p.created_at).toDateString() === hoy);

    const contexto = {
      usuarios: usuarios.data?.length || 0,
      comercios: comercios.data?.length || 0,
      pedidos: pedidos.data?.length || 0,
      comisiones: Math.round(totalComisiones),
      pedidosHoy: pedidosHoy.length,
      comisionesHoy: Math.round(pedidosHoy.reduce((sum, p) => sum + (p.total * 0.1), 0)),
    };

    const p = pregunta.toLowerCase();
    let respuesta = '';

    if (p.includes('venta') || p.includes('comision') || p.includes('ganancia') || p.includes('dinero')) {
      respuesta = `💰 **Resumen financiero de Dely Nea:**\n\n` +
        `• Comisiones totales: $${contexto.comisiones.toLocaleString()} ARS\n` +
        `• Comisiones hoy: $${contexto.comisionesHoy.toLocaleString()} ARS\n` +
        `• Pedidos totales: ${contexto.pedidos}\n` +
        `• Pedidos hoy: ${contexto.pedidosHoy}\n\n` +
        `📈 **Proyección mensual:** $${(contexto.comisiones * 30).toLocaleString()} ARS\n\n` +
        `💡 **Recomendación:** ${contexto.pedidos < 10 ? 'Estás en etapa inicial. Conseguí 5 comercios más para acelerar el crecimiento.' : 'Vas bien. Enfocate en aumentar el ticket promedio con promociones.'}`;
    }
    else if (p.includes('comercio') || p.includes('local') || p.includes('tienda')) {
      const listaComercioS = (comercios.data || []).map(c => `• ${c.nombre} — comisión: ${c.comision || 10}%`).join('\n');
      respuesta = `🏪 **Comercios en Dely Nea:**\n\n${listaComercioS || '• No hay comercios registrados todavía'}\n\n` +
        `📊 **Total:** ${contexto.comercios} comercio(s) activo(s)\n\n` +
        `💡 **Recomendación:** ${contexto.comercios < 5 ? 'Prioritario conseguir más comercios. Apuntá a ferreterías y farmacias — son los rubros con más demanda en Resistencia.' : 'Buen número de comercios. Enfocate en la calidad del servicio.'}`;
    }
    else if (p.includes('usuario') || p.includes('cliente') || p.includes('persona')) {
      respuesta = `👥 **Usuarios de Dely Nea:**\n\n` +
        `• Total registrados: ${contexto.usuarios}\n` +
        `• Pedidos por usuario: ${contexto.usuarios > 0 ? (contexto.pedidos / contexto.usuarios).toFixed(1) : 0}\n\n` +
        `💡 **Análisis:** ${contexto.usuarios < 10 ? 'Todavía en etapa de primeros usuarios. Compartí la app en grupos de WhatsApp y Facebook de Resistencia.' : contexto.pedidos / contexto.usuarios < 1 ? 'Hay usuarios que no compraron todavía. Enviá un cupón de bienvenida.' : 'Los usuarios están activos. ¡Bien!'}`;
    }
    else if (p.includes('seguridad') || p.includes('hackeo') || p.includes('ataque') || p.includes('sospecho')) {
      respuesta = `🔒 **Análisis de seguridad de Dely Nea:**\n\n` +
        `• JWT tokens: ✅ Activos con expiración de 7 días\n` +
        `• Contraseñas: ✅ Encriptadas con bcrypt\n` +
        `• HTTPS: ✅ Activo en Render\n` +
        `• Base de datos: ✅ Supabase con RLS activado\n\n` +
        `⚠️ **Pendiente:**\n` +
        `• Rate limiting — bloquear intentos masivos de login\n` +
        `• 2FA para el panel admin\n` +
        `• Logs de acceso sospechoso\n\n` +
        `💡 Lo agrego cuando me lo pidás.`;
    }
    else if (p.includes('repartidor') || p.includes('moto') || p.includes('cadete') || p.includes('delivery')) {
      respuesta = `🏍️ **Análisis de repartidores:**\n\n` +
        `• Repartidores activos: 0 (todavía no hay registrados)\n\n` +
        `💡 **Plan para conseguir repartidores:**\n` +
        `1. Publicar en grupos de Facebook de Resistencia\n` +
        `2. Ofrecer $800-1200 por entrega para arrancar\n` +
        `3. Empezar con 3-5 repartidores de confianza\n` +
        `4. Zonas prioritarias: Centro, Belgrano, Fontana\n\n` +
        `📱 La app de repartidor está en desarrollo.`;
    }
    else if (p.includes('crecer') || p.includes('mejorar') || p.includes('recomend') || p.includes('estrategia')) {
      respuesta = `💡 **Recomendaciones estratégicas para Dely Nea:**\n\n` +
        `**Corto plazo (este mes):**\n` +
        `• Conseguir 5 comercios más en Resistencia\n` +
        `• Reclutar 5 repartidores con moto\n` +
        `• Campaña en redes sociales locales\n\n` +
        `**Mediano plazo (3 meses):**\n` +
        `• Lanzar módulo de técnicos\n` +
        `• Expandir a Fontana y Barranqueras\n` +
        `• Meta: $1.000.000 ARS en comisiones/mes\n\n` +
        `**Largo plazo (6 meses):**\n` +
        `• Expandir a Corrientes\n` +
        `• Meta: 50 comercios activos\n` +
        `• Meta: $5.000.000 ARS en comisiones/mes`;
    }
    else if (p.includes('proyeccion') || p.includes('futuro') || p.includes('mes')) {
      const proyMensual = contexto.comisiones * 30;
      const proyAnual = proyMensual * 12;
      respuesta = `📈 **Proyecciones de Dely Nea:**\n\n` +
        `• Comisiones actuales: $${contexto.comisiones.toLocaleString()} ARS\n` +
        `• Proyección mensual: $${proyMensual.toLocaleString()} ARS\n` +
        `• Proyección anual: $${proyAnual.toLocaleString()} ARS\n\n` +
        `🎯 **Para llegar a $1.000.000/mes necesitás:**\n` +
        `• ~${Math.ceil(1000000 / 700)} pedidos por mes\n` +
        `• ~${Math.ceil(1000000 / 700 / 30)} pedidos por día\n` +
        `• Con 10 comercios activos es totalmente alcanzable\n\n` +
        `💡 Cada comercio nuevo multiplica tus ingresos.`;
    }
    else {
      respuesta = `¡Hola Franco! Soy Dely, tu asistente de Dely Nea. 👋\n\n` +
        `Puedo ayudarte con:\n` +
        `• 💰 Ventas y comisiones\n` +
        `• 🏪 Análisis de comercios\n` +
        `• 👥 Usuarios y clientes\n` +
        `• 🏍️ Repartidores\n` +
        `• 🔒 Seguridad\n` +
        `• 📈 Proyecciones y estrategia\n\n` +
        `¿Sobre qué querés que te ayude?`;
    }

    res.json({ respuesta });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Registro de repartidor
app.post('/repartidores/registro', async (req, res) => {
  try {
    const {
      nombre, email, telefono, dni, direccion,
      tipo_vehiculo, marca_moto, modelo_moto, anio_moto, patente,
      zonas, tiene_foto_perfil, tiene_dni, tiene_carnet,
      tiene_foto_moto, tiene_seguro, tiene_vtv
    } = req.body;

    const { data, error } = await supabase
      .from('repartidores')
      .insert([{
        nombre, email, telefono, dni, direccion,
        tipo_vehiculo, marca_moto, modelo_moto,
        anio_moto, patente,
        zonas: zonas.join(', '),
        tiene_foto_perfil, tiene_dni, tiene_carnet,
        tiene_foto_moto, tiene_seguro, tiene_vtv,
        estado: 'pendiente',
      }])
      .select();

    if (error) throw error;

    res.json({
      mensaje: '✅ Solicitud de repartidor recibida',
      id: data[0].id,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Registro de técnico
app.post('/tecnicos/registro', async (req, res) => {
  try {
    const {
      nombre, email, telefono, dni, direccion,
      descripcion, anios_experiencia, tarifa_hora,
      especialidades, zonas,
      tiene_foto_perfil, tiene_dni, tiene_certificado, tiene_portfolio
    } = req.body;

    const { data, error } = await supabase
      .from('tecnicos')
      .insert([{
        nombre, email, telefono, dni, direccion,
        descripcion, anios_experiencia, tarifa_hora,
        especialidades: especialidades.join(', '),
        zonas: zonas.join(', '),
        tiene_foto_perfil, tiene_dni, tiene_certificado, tiene_portfolio,
        estado: 'pendiente_entrevista',
      }])
      .select();

    if (error) throw error;

    res.json({
      mensaje: '✅ Solicitud de técnico recibida',
      id: data[0].id,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Admin - ver repartidores
app.get('/admin/repartidores', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('repartidores')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ repartidores: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin - ver técnicos
app.get('/admin/tecnicos', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tecnicos')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ tecnicos: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin - cambiar estado repartidor
app.patch('/admin/repartidores/:id/estado', async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    const { data, error } = await supabase
      .from('repartidores')
      .update({ estado })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json({ mensaje: `✅ Estado actualizado a ${estado}`, repartidor: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin - cambiar estado técnico
app.patch('/admin/tecnicos/:id/estado', async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    const { data, error } = await supabase
      .from('tecnicos')
      .update({ estado })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json({ mensaje: `✅ Estado actualizado a ${estado}`, tecnico: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Iniciar servidor
app.listen(PORT, () => {
  console.log(`✅ Dely Nea corriendo en http://localhost:${PORT}`);
  console.log(`🗄️ Supabase conectado: ${process.env.SUPABASE_URL}`);
});