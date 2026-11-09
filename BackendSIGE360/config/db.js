const {Pool} = require('pg');

const pool = new Pool({
    host: process.env.BD_HOST,
    port: process.env.BD_PORT,
    user: process.env.BD_USER,
    password: process.env.BD_PASS,
    database: process.env.BD_NAME
})

pool.query('select now()')
.then(() => console.log('O Banco de Dados Está Ativa'))
.catch((error) => console.error('Erro em conexão ao BD:', error));

module.exports = pool;