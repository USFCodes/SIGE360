'use client';

import { usePathname } from 'next/navigation';
import { MdAttachMoney, MdBadge, MdBarChart, MdCalculate, MdClass, MdCloudUpload, MdDashboard, MdDocumentScanner, MdFactCheck, MdGrade, MdNotifications, MdPeople, MdPersonAdd, MdReceiptLong, MdReportProblem, MdSupervisedUserCircle, MdSupportAgent, MdManageSearch, MdMonitorHeart, MdSettings, MdNaturePeople } from 'react-icons/md';
import { FaSchool } from 'react-icons/fa6';
import { User2Icon } from 'lucide-react';
import LayoutAdmin from '@/components/layout-admin';
import TeacherDashboardShell from '@/components/teacher-dashboard-shell';
import { PiTelevision } from 'react-icons/pi';

const icon = 'nav-icons';

const DASHBOARDS = {
  direcao: {
    theme: 'school',
    navList: [
      { title: 'Início', icon: <MdDashboard className={icon} />, href: '/dashboard/direcao' },
      { title: 'As Pessoas', icon: <MdBadge className={icon} />, href: '/dashboard/direcao/usuarios' },
      { title: 'Turmas', icon: <MdClass className={icon} />, href: '/dashboard/direcao/turmas' },
      { title: 'Pendentes', icon: <MdFactCheck className={icon} />, href: '/dashboard/direcao/matriculas' },
      { title: 'Alunos', icon: <MdPeople className={icon} />, href: '/dashboard/direcao/alunos' },
      { title: 'Encarregados', icon: <MdSupervisedUserCircle className={icon} />, href: '/dashboard/direcao/encarregados' },
      { title: 'As Pautas', icon: <MdCalculate className={icon} />, href: '/dashboard/direcao/notas' },
      { title: 'Finanças', icon: <MdAttachMoney className={icon} />, href: '/dashboard/direcao/financas' },
      { title: 'Partilha', icon: <MdCloudUpload className={icon} />, href: '/dashboard/direcao/partilha' },
      { title: 'Notificações', icon: <MdNotifications className={icon} />, href: '/dashboard/direcao/notificacoes' },
      { title: 'Relatórios', icon: <MdBarChart className={icon} />, href: '/dashboard/direcao/relatorios' },
      { title: 'Mídia', icon: <PiTelevision className={icon} />, href: '/dashboard/direcao/media' }
    ]
  },
  secretaria: {
    theme: 'school',
    navList: [
      { title: 'Início', icon: <MdDashboard className={icon} />, href: '/dashboard/secretaria' },
      { title: 'Pagamentos', icon: <MdAttachMoney className={icon} />, href: '/dashboard/secretaria/propinas' },
      { title: 'Matrícula', icon: <MdPersonAdd className={icon} />, href: '/dashboard/secretaria/matricular' },
      { title: 'Finanças', icon: <MdReceiptLong className={icon} />, href: '/dashboard/secretaria/recibos' },
      { title: 'Notas', icon: <MdCalculate className={icon} />, href: '/dashboard/secretaria/notas' },
      { title: 'Em atraso', icon: <MdReportProblem className={icon} />, href: '/dashboard/secretaria/devedores' },
      { title: 'Encarregados', icon: <MdSupervisedUserCircle className={icon} />, href: '/dashboard/secretaria/encarregados' },
      { title: 'Turmas', icon: <MdClass className={icon} />, href: '/dashboard/secretaria/turmas' },
      { title: 'Professores', icon: <MdBadge className={icon} />, href: '/dashboard/secretaria/professores' },
      { title: 'Partilha', icon: <MdCloudUpload className={icon} />, href: '/dashboard/secretaria/partilha' },
      { title: 'Notificações', icon: <MdNotifications className={icon} />, href: '/dashboard/secretaria/notificacoes' }
    ]
  },
  tesouraria: {
    theme: 'default',
    navList: [
      { title: 'Início', icon: <MdDashboard className={icon} />, href: '/dashboard/tesouraria' },
      { title: 'Caixa', icon: <MdAttachMoney className={icon} />, href: '/dashboard/tesouraria/propinas' },
      { title: 'Recibos', icon: <MdReceiptLong className={icon} />, href: '/dashboard/tesouraria/recibos' },
      { title: 'Partilha', icon: <MdCloudUpload className={icon} />, href: '/dashboard/tesouraria/partilha' },
      { title: 'Relatórios', icon: <MdBarChart className={icon} />, href: '/dashboard/tesouraria/relatorios' },
      { title: 'Notificações', icon: <MdNotifications className={icon} />, href: '/dashboard/tesouraria/notificacoes' }
    ]
  },
  professor: {
    theme: 'school',
    navList: [
      { title: 'Início', icon: <MdDashboard className={icon} />, href: '/dashboard/professor' },
      { title: 'Presenças', icon: <MdFactCheck className={icon} />, href: '/dashboard/professor/presencas' },
      { title: 'Turma dirigida', icon: <MdGrade className={icon} />, href: '/dashboard/professor/dir-turma' },
      { title: 'Alunos', icon: <MdPeople className={icon} />, href: '/dashboard/professor/alunos' },
      { title: 'Notas', icon: <MdCalculate className={icon} />, href: '/dashboard/professor/notas' },
      { title: 'Turmas', icon: <MdClass className={icon} />, href: '/dashboard/professor/turmas' },
      { title: 'Notificações', icon: <MdNotifications className={icon} />, href: '/dashboard/professor/notificacoes' },
      { title: 'Partilha', icon: <MdCloudUpload className={icon} />, href: '/dashboard/professor/partilha' }
    ]
  },
  aluno: {
    theme: 'school',
    navList: [
      { title: 'Início', icon: <MdDashboard className={icon} />, href: '/dashboard/aluno' },
      { title: 'Finanças', icon: <MdReceiptLong className={icon} />, href: '/dashboard/aluno/financas' }
    ]
  },
  estudante: {
    theme: 'school',
    navList: [
      { title: 'Início', icon: <MdDashboard className={icon} />, href: '/dashboard/estudante' },
      { title: 'Finanças', icon: <MdReceiptLong className={icon} />, href: '/dashboard/estudante/financas' }
    ]
  },
  owner: {
    theme: 'owner',
    sigla: 'GST',
    navList: [
      { title: 'Painel', icon: <MdDashboard className={icon} />, href: '/dashboard/owner' },
      { title: 'Escolas', icon: <FaSchool className={icon} />, href: '/dashboard/owner/escolas' },
      { title: 'Contas e acessos', icon: <User2Icon className={icon} />, href: '/dashboard/owner/usuarios' },
      { title: 'Alunos', icon: <MdNaturePeople className={icon} />, href: '/dashboard/owner/alunos' },
      { title: 'Suporte', icon: <MdSupportAgent className={icon} />, href: '/dashboard/owner/suporte' },
      { title: 'Notificações', icon: <MdNotifications className={icon} />, href: '/dashboard/owner/notificacoes' },
      { title: 'Sistema', icon: <MdMonitorHeart className={icon} />, href: '/dashboard/owner/sistema' },
    ]
  }
};

export default function DashboardLayout({ children }) {
  const pathname = usePathname();
  const role = pathname.split('/')[2];
  const dashboard = DASHBOARDS[role];
  if (!dashboard) return children;
  const professorOwnDesign = [
    '/dashboard/professor/partilha',
    '/dashboard/professor/notificacoes',
    '/dashboard/professor/uploads'
  ].some((route) => pathname === route || pathname.startsWith(`${route}/`));

  return (
    <LayoutAdmin navList={dashboard.navList} papel={role} sigla={dashboard.sigla} theme={dashboard.theme} >
      {role === 'professor' && !professorOwnDesign
        ? <TeacherDashboardShell>{children}</TeacherDashboardShell>
        : children}
    </LayoutAdmin>
  );
}
