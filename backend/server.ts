import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT) || 5432,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl:      { rejectUnauthorized: false },
});

// Normalización de estatus en SQL — resuelve errores tipográficos en la fuente
const ESTATUS_CASE = `
  CASE UPPER(TRIM(estatus))
    WHEN 'CERRADA'      THEN 'Cerrada'
    WHEN 'CERRADO'      THEN 'Cerrada'
    WHEN 'EMBALADA'     THEN 'Embalada'
    WHEN 'EMBALADO'     THEN 'Embalada'
    WHEN 'PICKEADO'     THEN 'Pickeado'
    WHEN 'PIKEADO'      THEN 'Pickeado'
    WHEN 'PICADO'       THEN 'Pickeado'
    WHEN 'LISTO'        THEN 'Pickeado'
    WHEN 'LISTA'        THEN 'Pickeado'
    WHEN 'PARCIAL'      THEN 'Parcial'
    WHEN 'SIN PICKEAR'  THEN 'Sin Pickear'
    WHEN 'SIN PIKEADO'  THEN 'Sin Pickear'
    WHEN 'SIN PIKEADO'  THEN 'Sin Pickear'
    ELSE INITCAP(TRIM(estatus))
  END
`;

// Devuelve WHERE + params dado desde/hasta sobre fecha_recepcion
// Si no se pasa ninguna fecha, defaultea a HOY
function buildWhere(desde?: string, hasta?: string): { where: string; params: string[] } {
  const params: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const d = desde || today;
  const h = hasta || today;
  params.push(d, h);
  return {
    where: `WHERE fecha_recepcion >= $1 AND fecha_recepcion <= $2`,
    params,
  };
}

// GET /api/pedidos-sap/resumen  — endpoint principal del dashboard
// Parámetros: desde=YYYY-MM-DD  hasta=YYYY-MM-DD  (default: hoy)
app.get('/api/pedidos-sap/resumen', async (req, res) => {
  try {
    const { desde, hasta } = req.query as { desde?: string; hasta?: string };
    const { where, params } = buildWhere(desde, hasta);

    const [kpis, porEstatus, porCliente, porOla, porUsuario, porTipoEnvio, tendencia] =
      await Promise.all([

        // KPIs globales + Lead Times
        pool.query(`
          SELECT
            COUNT(*)::int                                       AS total_pedidos,
            COALESCE(SUM(unidades),0)::int                     AS total_unidades,
            COALESCE(SUM(entregadas),0)::int                   AS total_entregadas,
            COALESCE(SUM(abiertas),0)::int                     AS total_abiertas,
            COUNT(*) FILTER (WHERE (${ESTATUS_CASE}) IN ('Sin Pickear','Parcial'))::int AS backlog,
            COUNT(*) FILTER (WHERE fec_compromiso < CURRENT_DATE AND (${ESTATUS_CASE}) <> 'Cerrada')::int AS sla_vencidos,
            COUNT(*) FILTER (WHERE fec_compromiso = CURRENT_DATE)::int                                    AS sla_hoy,
            COUNT(*) FILTER (WHERE fec_compromiso > CURRENT_DATE)::int                                    AS sla_futuros,
            ROUND(AVG(
              (fec_lista_picking - fecha_recepcion) * 24.0
            ) FILTER (WHERE fec_lista_picking IS NOT NULL AND fecha_recepcion IS NOT NULL), 1)
              AS lead_time_sap_picking_hrs,
            ROUND(AVG(
              (fec_actual_picking - fec_lista_picking) * 24.0
            ) FILTER (WHERE fec_actual_picking IS NOT NULL AND fec_lista_picking IS NOT NULL), 1)
              AS lead_time_picking_cierre_hrs
          FROM gold_layer.fact_pedidos_bajados_cl ${where}
        `, params),

        // Por estatus normalizado
        pool.query(`
          SELECT
            (${ESTATUS_CASE})             AS estatus,
            COUNT(*)::int                 AS pedidos,
            COALESCE(SUM(unidades),0)::int AS unidades,
            COALESCE(SUM(entregadas),0)::int AS entregadas,
            COALESCE(SUM(abiertas),0)::int   AS abiertas
          FROM gold_layer.fact_pedidos_bajados_cl ${where}
          GROUP BY 1
          ORDER BY pedidos DESC
        `, params),

        // Por cliente / marketplace
        pool.query(`
          SELECT
            nombre_cliente                  AS cliente,
            COUNT(*)::int                   AS pedidos,
            COALESCE(SUM(unidades),0)::int  AS unidades,
            COALESCE(SUM(entregadas),0)::int AS entregadas
          FROM gold_layer.fact_pedidos_bajados_cl ${where}
          GROUP BY 1
          ORDER BY pedidos DESC
          LIMIT 10
        `, params),

        // Por ola (abiertas primero, luego cerradas más recientes)
        pool.query(`
          SELECT
            num_ola,
            COUNT(*)::int                   AS pedidos,
            COALESCE(SUM(unidades),0)::int  AS unidades,
            COALESCE(SUM(abiertas),0)::int  AS abiertas,
            MAX(${ESTATUS_CASE})            AS estatus_ultimo,
            MAX(fec_lista_picking)          AS fecha
          FROM gold_layer.fact_pedidos_bajados_cl
          ${where} AND (num_ola IS NOT NULL AND num_ola <> '')
          GROUP BY num_ola
          ORDER BY abiertas DESC, fecha DESC
          LIMIT 20
        `, params),

        // Productividad por usuario (top 10)
        pool.query(`
          SELECT
            usuario,
            COUNT(*)::int                    AS pedidos,
            COALESCE(SUM(unidades),0)::int   AS unidades,
            COALESCE(SUM(entregadas),0)::int AS entregadas
          FROM gold_layer.fact_pedidos_bajados_cl
          ${where} AND (usuario IS NOT NULL AND usuario <> '')
          GROUP BY 1
          ORDER BY unidades DESC
          LIMIT 10
        `, params),

        // Por tipo de envío
        pool.query(`
          SELECT
            COALESCE(NULLIF(TRIM(tipo_envio),''), 'SIN DATOS') AS tipo_envio,
            COUNT(*)::int                   AS pedidos,
            COALESCE(SUM(unidades),0)::int  AS unidades
          FROM gold_layer.fact_pedidos_bajados_cl ${where}
          GROUP BY 1
          ORDER BY pedidos DESC
        `, params),

        // Tendencia últimos 7 días (independiente del filtro de fecha)
        pool.query(`
          SELECT
            fecha_recepcion::date           AS fecha,
            COUNT(*)::int                   AS pedidos,
            COALESCE(SUM(unidades),0)::int  AS unidades,
            COALESCE(SUM(entregadas),0)::int AS entregadas
          FROM gold_layer.fact_pedidos_bajados_cl
          WHERE fecha_recepcion >= CURRENT_DATE - INTERVAL '7 days'
          GROUP BY 1
          ORDER BY 1
        `, []),
      ]);

    const kpi = kpis.rows[0];
    const cumplimiento = kpi.total_unidades > 0
      ? Math.round(kpi.total_entregadas / kpi.total_unidades * 1000) / 10
      : 0;

    res.json({
      ok: true,
      filtro: { desde: params[0], hasta: params[1] },
      kpis: { ...kpi, cumplimiento },
      por_estatus:   porEstatus.rows,
      por_cliente:   porCliente.rows,
      por_ola:       porOla.rows,
      por_usuario:   porUsuario.rows,
      por_tipo_envio: porTipoEnvio.rows,
      tendencia:     tendencia.rows,
    });
  } catch (err: any) {
    console.error('Error resumen:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/pedidos-sap — detalle de filas (para tabla drill-down)
app.get('/api/pedidos-sap', async (req, res) => {
  try {
    const { desde, hasta } = req.query as { desde?: string; hasta?: string };
    const { where, params } = buildWhere(desde, hasta);
    const result = await pool.query(`
      SELECT
        num_pedido_mv, num_pedido_sap, nombre_cliente,
        fecha_recepcion, hora_recepcion, fec_compromiso,
        tipo_envio, unidades, entregadas, abiertas,
        num_ola, usuario, fec_lista_picking,
        hora_creacion_picking, hora_cierre_status,
        (${ESTATUS_CASE}) AS estatus
      FROM gold_layer.fact_pedidos_bajados_cl ${where}
      ORDER BY fecha_recepcion DESC, hora_recepcion DESC
      LIMIT 5000
    `, params);
    res.json({ ok: true, rows: result.rows, total: result.rowCount });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/kpi-operarios — desde mart_kpi_operarios_cl
// Parámetros: desde, hasta (fecha), tipo (Picking|Embalaje|todos), almacen (BBCE|BBMV|todos)
app.get('/api/kpi-operarios', async (req, res) => {
  try {
    const { desde, hasta, tipo, almacen } = req.query as {
      desde?: string; hasta?: string; tipo?: string; almacen?: string;
    };
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const d = desde || yesterday;
    const h = hasta  || yesterday;

    // Construir filtros dinámicos
    const params: string[] = [d, h];
    let extraFilters = '';
    if (tipo && tipo !== 'todos') {
      params.push(tipo);
      extraFilters += ` AND tipo = $${params.length}`;
    }
    if (almacen && almacen !== 'todos') {
      params.push(almacen.toUpperCase());
      extraFilters += ` AND almacen = $${params.length}`;
    }

    const [resumen, detalle, tendencia] = await Promise.all([

      // KPIs globales + desglose por área
      pool.query(`
        SELECT
          COUNT(DISTINCT nombre)::int                                          AS total_operarios,
          COUNT(DISTINCT nombre) FILTER (WHERE almacen = 'BBCE')::int         AS operarios_bbce,
          COUNT(DISTINCT nombre) FILTER (WHERE almacen = 'BBMV')::int         AS operarios_bbmv,
          COALESCE(SUM(olas),0)::int                                          AS total_olas,
          COALESCE(SUM(pick_lists),0)::int                                    AS total_listas,
          COALESCE(SUM(unidades),0)::int                                      AS total_unidades,
          COALESCE(SUM(unidades) FILTER (WHERE tipo = 'Picking'),0)::int      AS total_pickeado,
          COALESCE(SUM(unidades) FILTER (WHERE tipo = 'Embalaje'),0)::int     AS total_embalado,
          COALESCE(SUM(unidades) FILTER (WHERE almacen = 'BBCE'),0)::int      AS unidades_bbce,
          COALESCE(SUM(olas)     FILTER (WHERE almacen = 'BBMV'),0)::int      AS olas_bbmv,
          COALESCE(SUM(pick_lists) FILTER (WHERE almacen = 'BBMV'),0)::int    AS listas_bbmv,
          ROUND(AVG(min_prom_x_lista) FILTER (WHERE tipo = 'Picking'),1)      AS prom_min_picking,
          ROUND(AVG(min_prom_x_lista) FILTER (WHERE tipo = 'Embalaje'),1)     AS prom_min_embalaje
        FROM gold_layer.mart_kpi_operarios_cl
        WHERE fecha >= $1 AND fecha <= $2${extraFilters}
      `, params),

      // Detalle por operario + área
      pool.query(`
        SELECT
          nombre,
          almacen,
          tipo,
          SUM(olas)::int                        AS olas,
          SUM(pick_lists)::int                  AS pick_lists,
          ROUND(AVG(min_prom_x_lista),1)        AS min_prom_x_lista,
          SUM(unidades)::int                    AS unidades,
          ROUND(AVG(unid_x_hora),1)             AS unid_x_hora
        FROM gold_layer.mart_kpi_operarios_cl
        WHERE fecha >= $1 AND fecha <= $2${extraFilters}
        GROUP BY nombre, almacen, tipo
        ORDER BY almacen, unidades DESC
        LIMIT 100
      `, params),

      // Tendencia 14 días por área y tipo
      pool.query(`
        SELECT
          fecha::date                           AS fecha,
          almacen,
          tipo,
          SUM(unidades)::int                    AS unidades,
          SUM(olas)::int                        AS olas,
          SUM(pick_lists)::int                  AS pick_lists,
          COUNT(DISTINCT nombre)::int           AS operarios
        FROM gold_layer.mart_kpi_operarios_cl
        WHERE fecha >= CURRENT_DATE - INTERVAL '14 days'
        GROUP BY fecha::date, almacen, tipo
        ORDER BY fecha::date, almacen, tipo
      `, []),
    ]);

    res.json({
      ok: true,
      filtro: { desde: d, hasta: h, tipo: tipo || 'todos', almacen: almacen || 'todos' },
      resumen: resumen.rows[0],
      detalle: detalle.rows,
      tendencia: tendencia.rows,
    });
  } catch (err: any) {
    console.error('Error kpi-operarios:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// Servir archivos estáticos solo en desarrollo local
if (process.env.NODE_ENV !== 'production') {
  app.use(express.static(require('path').join(__dirname, '..')));
}

// En Vercel, exporta el app como handler serverless
// En local, inicia el servidor HTTP directamente
if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3001;
  app.listen(PORT, () => console.log(`Backend DashCD corriendo en http://localhost:${PORT}`));
}

module.exports = app;
