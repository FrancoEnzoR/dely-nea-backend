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

// Obtener comercios ordenados por distancia
app.get('/comercios', async (req, res) => {
  try {
    const { lat, lng } = req.query;

    const { data, error } = await supabase
      .from('comercios')
      .select('*, categorias(nombre, icono)')
      .eq('activo', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    let comercios = data;

    if (lat && lng) {
      const calcDistancia = (lat1, lng1, lat2, lng2) => {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return Math.round((R * c) * 10) / 10;
      };

      comercios = comercios
        .map(c => ({
          ...c,
          distancia: c.latitud && c.longitud
            ? calcDistancia(parseFloat(lat), parseFloat(lng), c.latitud, c.longitud)
            : 999,
          tiempo_estimado: c.latitud && c.longitud
            ? Math.round(calcDistancia(parseFloat(lat), parseFloat(lng), c.latitud, c.longitud) / 40 * 60) + ' min'
            : null
        }))
        .sort((a, b) => a.distancia - b.distancia);
    }

    res.json({ comercios });
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
// Obtener ofertas activas
app.get('/ofertas', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ofertas')
      .select('*')
      .eq('activo', true)
      .order('orden');
    if (error) throw error;
    res.json({ ofertas: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear oferta
app.post('/ofertas', async (req, res) => {
  try {
    const { titulo, subtitulo, emoji, color, btn_texto, orden, imagen_url, etiqueta } = req.body;
    const { data, error } = await supabase
      .from('ofertas')
      .insert([{ titulo, subtitulo, emoji, color, btn_texto, orden, imagen_url, etiqueta, activo: true }])
      .select();
    if (error) throw error;
    res.json({ mensaje: '✅ Oferta creada', oferta: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar oferta
app.patch('/ofertas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const { data, error } = await supabase
      .from('ofertas')
      .update(updates)
      .eq('id', id)
      .select();
    if (error) throw error;
    res.json({ mensaje: '✅ Oferta actualizada', oferta: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar oferta
app.delete('/ofertas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('ofertas')
      .delete()
      .eq('id', id);
    if (error) throw error;
    res.json({ mensaje: '✅ Oferta eliminada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Registro de comercio
app.post('/comercios/registro', async (req, res) => {
  try {
    const {
      nombre, email, telefono, direccion, descripcion,
      cuit, password, categoria_principal,
      tiene_foto_local, tiene_logo, tiene_documento
    } = req.body;

    const passwordEncriptada = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from('comercios')
      .insert([{
        nombre, email, telefono, direccion, descripcion,
        cuit, password: passwordEncriptada,
        categoria_principal,
        tiene_foto_local, tiene_logo, tiene_documento,
        activo: false,
        estado: 'pendiente',
      }])
      .select();

    if (error) throw error;

    res.json({
      mensaje: '✅ Comercio registrado exitosamente',
      id: data[0].id,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Admin - ver todos los comercios
app.get('/admin/comercios', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('comercios')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ comercios: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin - cambiar estado comercio
app.patch('/admin/comercios/:id/estado', async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    const activo = estado === 'aprobado';
    const { data, error } = await supabase
      .from('comercios')
      .update({ estado, activo })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json({ mensaje: `✅ Comercio ${estado}`, comercio: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Obtener mensajes de un chat
app.get('/mensajes/:pedido_id/:tipo', async (req, res) => {
  try {
    const { pedido_id, tipo } = req.params;
    const { data, error } = await supabase
      .from('mensajes')
      .select('*')
      .eq('pedido_id', pedido_id)
      .eq('receptor_tipo', tipo)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ mensajes: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Enviar mensaje
app.post('/mensajes', async (req, res) => {
  try {
    const { pedido_id, emisor_id, emisor_tipo, receptor_tipo, contenido } = req.body;
    const { data, error } = await supabase
      .from('mensajes')
      .insert([{ pedido_id, emisor_id, emisor_tipo, receptor_tipo, contenido }])
      .select();
    if (error) throw error;
    res.json({ mensaje: '✅ Mensaje enviado', data: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Marcar mensajes como leídos
app.patch('/mensajes/leer/:pedido_id', async (req, res) => {
  try {
    const { pedido_id } = req.params;
    const { receptor_tipo } = req.body;
    await supabase
      .from('mensajes')
      .update({ leido: true })
      .eq('pedido_id', pedido_id)
      .eq('receptor_tipo', receptor_tipo);
    res.json({ mensaje: '✅ Mensajes leídos' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener todos los chats de soporte para el admin
app.get('/admin/chats/soporte', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('mensajes')
      .select('*, pedidos(id, usuario_id, comercio_id, estado, total)')
      .eq('receptor_tipo', 'soporte')
      .eq('leido', false)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ mensajes: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Dely IA — Con Claude API real y memoria de conversación
app.post('/dely-servicios', async (req, res) => {
  try {
    const { mensaje, categoria, tiene_imagen, cliente_id, cliente_nombre, historial_chat } = req.body;

    const CATEGORIAS = ['Plomería','Electricidad','Pintura','Gasista','Refrigeración','Mecánica','Limpieza','Piletero','Carpintería','Cerrajería','Técnico PC','Antenas/TV'];

    const systemPrompt = `Sos Dely, la asistente virtual de Dely Nea, una plataforma de servicios técnicos a domicilio en Resistencia, Chaco, Argentina.

Tu personalidad: amigable, cálida, natural. Hablás en español rioplatense (usás "vos", "te", "podés"). No sos robótica ni repetitiva. Respondés de forma conversacional y breve (máximo 3-4 oraciones por respuesta).

Tu objetivo: ayudar al cliente a describir su problema y determinar qué técnico necesita. Hacés preguntas naturales para entender mejor el problema, como lo haría un amigo que te ayuda.

Categorías disponibles: ${CATEGORIAS.join(', ')}.

Reglas importantes:
- Si identificás claramente la categoría, indicalo al final con exactamente este formato: CATEGORIA: [nombre]
- Si el cliente parece confundido, angustiado o tiene una emergencia (olor a gas, inundación, cortocircuito con riesgo), indicalo con: URGENTE: true
- NO repitas siempre las mismas preguntas. Adaptate a lo que te dice el cliente.
- Si el cliente ya describió bien el problema, no le pidas más info innecesaria. Confirmá que entendiste y decile que puede enviar la solicitud.
- Si la situación involucra gas con riesgo, recordale que abra ventanas y salga antes de todo.
- Nunca rompas el personaje. Sos Dely, no una IA genérica.
${categoria ? `\nEl cliente ya seleccionó la categoría: ${categoria}. Ayudalo a describir mejor el problema para esa categoría.` : ''}`;

    // Armar historial para Claude
    const mensajesAPI = [];

    if (historial_chat && historial_chat.length > 0) {
      for (const msg of historial_chat) {
        if (msg.tipo === 'usuario' && msg.contenido) {
          mensajesAPI.push({ role: 'user', content: msg.contenido });
        } else if (msg.tipo === 'ia' && msg.contenido) {
          mensajesAPI.push({ role: 'assistant', content: msg.contenido });
        }
      }
    }

    // Agregar el mensaje actual
    mensajesAPI.push({ role: 'user', content: tiene_imagen ? `${mensaje} [El cliente adjuntó una foto del problema]` : mensaje });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: systemPrompt,
        messages: mensajesAPI,
      }),
    });

    const data = await response.json();
    let respuestaRaw = data.content?.[0]?.text || 'No pude procesar tu consulta. Intentá de nuevo.';

    // Extraer categoría detectada si la hay
    let categoriaDetectada = categoria || null;
    let esUrgente = false;

    const matchCategoria = respuestaRaw.match(/CATEGORIA:\s*(.+)/i);
    if (matchCategoria) {
      categoriaDetectada = matchCategoria[1].trim();
      respuestaRaw = respuestaRaw.replace(/CATEGORIA:.+/gi, '').trim();
    }

    const matchUrgente = respuestaRaw.match(/URGENTE:\s*true/i);
    if (matchUrgente) {
      esUrgente = true;
      respuestaRaw = respuestaRaw.replace(/URGENTE:.+/gi, '').trim();
    }

    // Guardar en DB
    try {
      await supabase.from('conversaciones_ia').insert([{
        cliente_id: cliente_id || null,
        cliente_nombre: cliente_nombre || 'Anonimo',
        mensaje,
        respuesta_ia: respuestaRaw,
        categoria_detectada: categoriaDetectada,
        requiere_atencion: esUrgente,
        leido_admin: false,
      }]);
    } catch (dbErr) {
      console.log('Error guardando conversacion:', dbErr);
    }

    res.json({
      respuesta: respuestaRaw,
      categoria_detectada: categoriaDetectada,
      requiere_atencion: esUrgente,
    });

  } catch (error) {
    console.error('Error dely-servicios:', error);
    res.status(500).json({ error: error.message });
  }
});
// Crear solicitud de servicio técnico
app.post('/servicios', async (req, res) => {
  try {
    const { cliente_id, categoria, descripcion, direccion, latitud, longitud } = req.body;

    // Generar código de 4 dígitos
    const codigo = Math.floor(1000 + Math.random() * 9000).toString();

    const { data, error } = await supabase
      .from('servicios_tecnicos')
      .insert([{
        cliente_id, categoria, descripcion,
        direccion, latitud, longitud,
        estado: 'solicitado',
        codigo_confirmacion: codigo,
      }])
      .select()
      .single();

    if (error) throw error;

    res.json({
      mensaje: '✅ Solicitud de servicio creada',
      servicio: data,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener un servicio por su ID
app.get('/servicios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('servicios_tecnicos')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    res.json({ servicio: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Obtener servicios de un cliente
app.get('/servicios/cliente/:cliente_id', async (req, res) => {
  try {
    const { cliente_id } = req.params;
    const { data, error } = await supabase
      .from('servicios_tecnicos')
      .select('*')
      .eq('cliente_id', cliente_id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ servicios: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener todos los servicios para el admin
app.get('/admin/servicios', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('servicios_tecnicos')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ servicios: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar estado del servicio
app.patch('/servicios/:id/estado', async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, tecnico_id } = req.body;
    const updates = { estado, updated_at: new Date() };
    if (tecnico_id) updates.tecnico_id = tecnico_id;
    const { data, error } = await supabase
      .from('servicios_tecnicos')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json({ mensaje: `✅ Estado actualizado a ${estado}`, servicio: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Técnico envía presupuesto
app.patch('/servicios/:id/presupuesto', async (req, res) => {
  try {
    const { id } = req.params;
    const { presupuesto } = req.body;
    const { data, error } = await supabase
      .from('servicios_tecnicos')
      .update({ presupuesto, estado: 'presupuestado', updated_at: new Date() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json({ mensaje: '✅ Presupuesto enviado', servicio: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cliente aprueba o rechaza presupuesto
app.patch('/servicios/:id/aprobar-presupuesto', async (req, res) => {
  try {
    const { id } = req.params;
    const { aprobado } = req.body;
    const estado = aprobado ? 'asignado' : 'solicitado';
    const { data, error } = await supabase
      .from('servicios_tecnicos')
      .update({
        presupuesto_aprobado: aprobado,
        estado,
        updated_at: new Date()
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json({ mensaje: aprobado ? '✅ Presupuesto aprobado' : '❌ Presupuesto rechazado', servicio: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Confirmar entrega con código
app.patch('/servicios/:id/confirmar', async (req, res) => {
  try {
    const { id } = req.params;
    const { codigo } = req.body;
    const { data: servicio } = await supabase
      .from('servicios_tecnicos')
      .select('codigo_confirmacion')
      .eq('id', id)
      .single();
    if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (servicio.codigo_confirmacion !== codigo) {
      return res.status(400).json({ error: '❌ Código incorrecto' });
    }
    const { data, error } = await supabase
      .from('servicios_tecnicos')
      .update({ estado: 'finalizado', updated_at: new Date() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json({ mensaje: '✅ Servicio confirmado y finalizado', servicio: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Actualizar pausa del servicio
app.patch('/servicios/:id/pausa', async (req, res) => {
  try {
    const { id } = req.params;
    const { fecha_pausa, modificado_por } = req.body;
    const { data, error } = await supabase
      .from('servicios_tecnicos')
      .update({
        estado_trabajo: 'pausado',
        estado: 'pausado',
        fecha_pausa,
        pausa_modificada_por: modificado_por,
        updated_at: new Date(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json({ mensaje: '✅ Trabajo pausado', servicio: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar estado de trabajo (en_curso, pausado, finalizado)
app.patch('/servicios/:id/estado-trabajo', async (req, res) => {
  try {
    const { id } = req.params;
    const { estado_trabajo, fecha_pausa, modificado_por } = req.body;
    const updates = {
      estado_trabajo,
      updated_at: new Date(),
    };
    if (estado_trabajo === 'finalizado') updates.estado = 'finalizado';
    if (estado_trabajo === 'pausado') {
      updates.estado = 'pausado';
      updates.fecha_pausa = fecha_pausa;
      updates.pausa_modificada_por = modificado_por;
    }
    if (estado_trabajo === 'en_proceso') updates.estado = 'en_curso';
    const { data, error } = await supabase
      .from('servicios_tecnicos')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json({ mensaje: '✅ Estado actualizado', servicio: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear servicio con tipo (urgente o agendado)
app.post('/servicios/agendar', async (req, res) => {
  try {
    const { cliente_id, categoria, descripcion, direccion, latitud, longitud, tipo_solicitud, fecha_agendada } = req.body;
    const codigo = Math.floor(1000 + Math.random() * 9000).toString();
    const { data, error } = await supabase
      .from('servicios_tecnicos')
      .insert([{
        cliente_id,
        categoria,
        descripcion,
        direccion,
        latitud,
        longitud,
        estado: 'solicitado',
        codigo_confirmacion: codigo,
        tipo_solicitud: tipo_solicitud || 'urgente',
        fecha_agendada: fecha_agendada || null,
      }])
      .select()
      .single();
    if (error) throw error;
    res.json({ mensaje: '✅ Servicio creado', servicio: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Iniciar servidor
app.listen(PORT, () => {
  console.log(`✅ Dely Nea corriendo en http://localhost:${PORT}`);
  console.log(`🗄️ Supabase conectado: ${process.env.SUPABASE_URL}`);
});