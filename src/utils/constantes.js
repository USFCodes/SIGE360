export const GUINE_REGIOES = {
  SAB: {
    nome: 'Sector Autónomo de Bissau (SAB)',
    locales: [
      'Bairro Militar',
      'Cupelum de Cima',
      'Cupelum de Baixo',
      'Penha',
      'Bairro de Ajuda',
      'Bandim 1',
      'Bandim 2',
      'Cuntum 1',
      'Cuntum 2',
      'Mindará',
      'Santa Luzia',
      'Quelelé',
      'Chão de Pepino',
      'Plaque 1',
      'Plaque 2',
      'Bissalanca',
      'Bairro Sintra',
      'Belém',
      'Pessaque',
      'Djaraf',
      'Alto Bandim',
      'Plano 1',
      'Antula',
      'Nhaque',
      'Outro (Especificar)',
    ],
  },
  BIOMBO: {
    nome: 'Biombo',
    locales: ['Quinhámel (Sede)', 'Safim', 'Prábis', 'Ondame', 'Suru', 'Biombo Centro', 'Outro (Especificar)'],
  },
  BAFATA: {
    nome: 'Bafatá',
    locales: ['Bafatá Centro', 'Contuboel', 'Bambadinca', 'Cossé', 'Galinharo', 'Sintchan', 'Outro (Especificar)'],
  },
  GABU: {
    nome: 'Gabú',
    locales: ['Gabú Centro', 'Pitche', 'Pirada', 'Sonaco', 'Buruntuma', 'Sintchan Oco', 'Outro (Especificar)'],
  },
  CACHEU: {
    nome: 'Cacheu',
    locales: ['Canchungo', 'Cacheu Sede', 'São Domingos', 'Bula', 'Caió', 'Ingoré', 'Outro (Especificar)'],
  },
  OIO: {
    nome: 'Oio',
    locales: ['Farim', 'Mansôa', 'Bissorã', 'Nhacra', 'Mansaba', 'Outro (Especificar)'],
  },
  QUINARA: {
    nome: 'Quinara',
    locales: ['Buba (Sede)', 'Empada', 'Fulacunda', 'Tite', 'Outro (Especificar)'],
  },
  TOMBALI: {
    nome: 'Tombali',
    locales: ['Catió (Sede)', 'Bedanda', 'Cacine', 'Quebo', 'Komo', 'Outro (Especificar)'],
  },
  BOLAMA: {
    nome: 'Bolama / Bijagós',
    locales: ['Bolama Sede', 'Bubaque', 'Caravela', 'Uno', 'Boido', 'Rubane', 'Outro (Especificar)'],
  },
};

export const GUINE_REGIOES_BAIRROS = Object.fromEntries(
  Object.entries(GUINE_REGIOES).map(([key, value]) => [
    key,
    { nome: value.nome, bairros: value.locales },
  ]),
);

export const TIPOS_GESTAO = [
  { id: '', nome: 'Tipo de Gestão', desc: '' },
  { id: 'PRIVADA', nome: 'Privada', desc: 'Gestão particular e autónoma com propinas' },
  { id: 'PUBLICA', nome: 'Pública', desc: 'Gerida e financiada pelo Ministério da Educação Nacional' },
  { id: 'ONG', nome: 'Organização Não Governamental', desc: 'Gerida por associação local de pais e moradores' },
];

export const TEMAS_WEB = [
  {
    id: 1,
    nome: 'Verde Nação (Bissau Standard)',
    corPrimaria: '#10b981',
    corSecundaria: '#f59e0b',
    bgPreview: 'from-emerald-900 via-slate-900 to-black',
    borderGlow: 'border-emerald-500/50',
    desc: 'Cores inspiradas na identidade nacional. Ideal para Liceus e escolas privadas de prestígio.',
  },
  {
    id: 2,
    nome: 'Azul Académico Tech',
    corPrimaria: '#0284c7',
    corSecundaria: '#38bdf8',
    bgPreview: 'from-sky-950 via-slate-900 to-slate-950',
    borderGlow: 'border-sky-500/50',
    desc: 'Visual cyber e moderno. Transmite inovação tecnológica e rigor pedagógico.',
  },
  {
    id: 3,
    nome: 'Ouro & Prestígio Dark',
    corPrimaria: '#f59e0b',
    corSecundaria: '#b45309',
    bgPreview: 'from-amber-950 via-slate-900 to-black',
    borderGlow: 'border-amber-500/50',
    desc: 'Estilo nobre e distinto, perfeito para colégios internacionais e institutos.',
  },
  {
    id: 4,
    nome: 'Neon Dinâmico',
    corPrimaria: '#ec4899',
    corSecundaria: '#8b5cf6',
    bgPreview: 'from-fuchsia-950 via-slate-900 to-slate-950',
    borderGlow: 'border-fuchsia-500/50',
    desc: 'Design vibrante focado no engajamento dos alunos e atividades extracurriculares.',
  },
];

export const NIVEIS_ENSINO_MAP = {
  1: { nome: "Jardim / Infantil", classes: ["1ª Etapa (Maternal)", "2ª Etapa (Jardim)", "3ª Etapa (Pré-Escolar)"] },
  2: { nome: "Ensino Básico (1º Ciclo)", classes: ["1ª Classe", "2ª Classe", "3ª Classe", "4ª Classe"] },
  3: { nome: "Ensino Básico (2º Ciclo)", classes: ["5ª Classe", "6ª Classe"] },
  4: { nome: "Ensino Básico (3º Ciclo)", classes: ["7ª Classe", "8ª Classe", "9ª Classe"] },
  5: { nome: "Ensino Secundário / Liceu", classes: ["10ª Classe", "11ª Classe", "12ª Classe"] },
  6: { nome: "Formação Técnico-Profissional", classes: ["Ano I (Módulo Inicial)", "Ano II (Módulo Intermédio)", "Ano III (Módulo Avançado)"] },
  7: { nome: "Ensino Superior / Universidade", classes: ["1º Ano (Licenciatura)", "2º Ano", "3º Ano", "4º Ano"] }
};