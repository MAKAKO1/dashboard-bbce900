// ⚠️ NO compartir este archivo — contiene credenciales de acceso a Supabase
const SUPABASE_URL = 'https://zwohsxuysjmokeilcnvo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3b2hzeHV5c2ptb2tlaWxjbnZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjQ2NjksImV4cCI6MjA5MTQwMDY2OX0.ndswKP7R81q5RBkkYBSIYpyhfA_yMpGv65rKBWQCvf0';
// En local apunta al servidor Express; en Vercel usa el mismo origen (rutas relativas /api/...)
const BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3001'
  : '';
