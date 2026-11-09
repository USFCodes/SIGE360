const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
dotenv.config();
const auth = require('./routes/auth');
const accounts = require('./routes/accounts');
const owner = require('./routes/owner');
const escolas = require('./routes/escolas')
const alunos = require('./routes/alunos');
const secretaria = require('./routes/secretaria');
const professores = require('./routes/professores');
const notas = require('./routes/notas');
const materias = require('./routes/materias');
const tesouraria = require('./routes/tesouraria')
const direcao = require('./routes/direcao')
const uploads = require('./routes/uploads')
const notificacoes = require('./routes/notificacoes');
const media = require('./routes/media');

const app = express();
const frontendOrigin = process.env.FRONTEND_URL;
let frontendUrl = null;

try {
  frontendUrl = frontendOrigin ? new URL(frontendOrigin) : null;
} catch (error) {
  console.error('FRONTEND_URL inválido para configuração de CORS:', error.message);
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    let requestUrl;
    try {
      requestUrl = new URL(origin);
    } catch {
      return callback(new Error('Origem inválida.'));
    }

    const sameOrigin = frontendUrl && requestUrl.origin === frontendUrl.origin;
    const frontendSubdomain = frontendUrl &&
      requestUrl.protocol === frontendUrl.protocol &&
      requestUrl.port === frontendUrl.port &&
      requestUrl.hostname.endsWith(`.${frontendUrl.hostname}`);
    const localSubdomain = process.env.NODE_ENV !== 'production' && requestUrl.hostname.endsWith('.localhost');

    if (sameOrigin || frontendSubdomain || localSubdomain) {
      return callback(null, true);
    }
    return callback(new Error('Origem não autorizada pelo CORS.'));
  },
  credentials: true
}));
app.use(express.json({limit: '0.3mb'}));
app.use(cookieParser());

app.use('/uploads', express.static(require('path').join(__dirname, 'public', 'uploads'), {
  dotfiles: 'deny',
  index: false,
  maxAge: '1h',
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
}));

app.use('/api/v1/auth', auth);
app.use('/api/v1/accounts', accounts);
app.use('/api/v1/owner', owner);
app.use('/api/v1/escolas', escolas);
app.use('/api/v1/alunos', alunos);
app.use('/api/v1/secretaria', secretaria);
app.use('/api/v1/professores', professores);
app.use('/api/v1/notas', notas);
app.use('/api/v1/materias', materias);
app.use('/api/v1/tesouraria', tesouraria);
app.use('/api/v1/direcao', direcao);
app.use('/api/v1/uploads', uploads);
app.use('/api/v1/notificacoes', notificacoes);
app.use('/api/v1/media', media);

if (require.main === module) {
  const PORT = process.env.BEND_PORT;
  app.listen(PORT, () => {console.log(`Servidor ligado na porta ${PORT}`);});
}

module.exports = app;