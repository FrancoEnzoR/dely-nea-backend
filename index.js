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

// Iniciar servidor
// Login con Google
app.post('/login-google', async (req, res) => {
  try {
    const { nombre, email, google_id } = req.body;

    // Verificar si el usuario ya existe
    const { data: usuarioExistente } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .single();

    let usuario;

    if (usuarioExistente) {
      // Ya existe, simplemente loguear
      usuario = usuarioExistente;
    } else {
      // No existe, crear nuevo usuario
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
app.listen(PORT, () => {
  console.log(`✅ Dely Nea corriendo en http://localhost:${PORT}`);
  console.log(`🗄️ Supabase conectado: ${process.env.SUPABASE_URL}`);
});