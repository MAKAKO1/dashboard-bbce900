// ⚠️ NO compartir este archivo — contiene credenciales de acceso a Supabase
const SUPABASE_URL = 'https://zwohsxuysjmokeilcnvo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3b2hzeHV5c2ptb2tlaWxjbnZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjQ2NjksImV4cCI6MjA5MTQwMDY2OX0.ndswKP7R81q5RBkkYBSIYpyhfA_yMpGv65rKBWQCvf0';
// En local apunta al servidor Express; en Vercel usa el mismo origen (rutas relativas /api/...)
const BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3001'
  : '';

// ── Endpoints Apps Script (única fuente — al re-deployar un hub, actualizar SOLO aquí) ──
// Hub DashCD (container-bound): eco-kpi, tienda-kpi, kpi-op-gs
const HUB_URL = 'https://script.google.com/macros/s/AKfycbyZU7IJt6E_v4S7T0-Uqbpr5ZGbGLMpJPlPpOGOmg91o8iKloR92rV7Yy8WMEfPbk3d/exec';
// Hub Logístico (standalone): picking/embalaje en vivo ECO + Tiendas
const HUB_LOG_URL = 'https://script.google.com/macros/s/AKfycbwyIns-vKBOufHE79lDLqUiv3yLccM6kfph_kL1O7TKJURaA_4oSiZiul7BgwF2Z4co/exec';
