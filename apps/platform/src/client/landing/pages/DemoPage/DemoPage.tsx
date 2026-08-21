import { PencilRuler } from 'lucide-react';
import type React from 'react';
import { Link } from 'react-router';

import { PublicLayout, useRegistry } from '@app/common';

import { Route } from '../../../../shared/router/routes';

/**
 * `/demo` — временная страница (задача 0092). Лендинг обещает пример проекта в четырёх местах, а настоящее демо
 * (задача 0064) решением автора 2026-08-21 делается в самом конце v0: до тех пор все четыре ссылки давали 404.
 * Здесь — честный ответ вместо ошибки; когда демо появится, страница **заменяется** им на этом же пути.
 *
 * Композиция — та же, что у двух уже существующих экранов такого рода (`common/NotFoundScreen`,
 * `project/EditorShell/DesktopOnlyScreen`): иллюстрация, заголовок, абзац, одна кнопка-ссылка. Третьей схемы для
 * одного и того же по смыслу экрана не заводим. Различение сессии — как в `DesktopOnlyScreen`: одна вёрстка,
 * меняется только адрес и подпись кнопки.
 *
 * Кнопка — `<Link>` с BEM-классами HeroUI (`.button .button--primary`), а не компонент `Button`: это
 * документированный способ библиотеки одевать ссылки роутера («Using with Routing Libraries» / «Direct Class
 * Application» в доках Link), и ровно так же сделана кнопка в `NotFoundScreen`. `Button` здесь дал бы `<button>`
 * без href — навигацию пришлось бы вешать руками, потеряв Cmd+клик и предпросмотр адреса.
 */
export const DemoPage: React.FC = () => {
  const { authManager } = useRegistry();
  const isAuthenticated = authManager.getCurrentUser() !== null;

  return (
    <>
      <title>Пример проекта — уютно</title>
      <meta
        name='description'
        content='Готового демо-проекта пока нет. Свою планировку можно собрать уже сейчас — бесплатно, прямо в браузере, без установки.'
      />
      <PublicLayout>
        <div className='flex min-h-full items-center justify-center px-4 py-12 lg:p-12'>
          <div className='flex w-full max-w-[400px] flex-col items-center gap-6 text-center'>
            <div
              aria-hidden='true'
              className='flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--surface-secondary)] text-[color:var(--muted)]'
            >
              <PencilRuler size={24} />
            </div>
            <div className='flex flex-col gap-2'>
              <h1 className='m-0 text-balance text-[22px] font-semibold tracking-[-0.02em] lg:text-[28px]'>
                Пример проекта ещё не готов
              </h1>
              <p className='m-0 text-pretty text-[14px] leading-[1.6] text-[color:var(--muted)] lg:text-[16px]'>
                Готовой планировки, которую можно посмотреть без аккаунта, пока нет. Собрать свою можно уже сейчас —
                бесплатно, прямо в браузере.
              </p>
            </div>
            <Link
              to={isAuthenticated ? Route.Projects : Route.Register}
              data-size='xl'
              className='button button--primary'
            >
              {isAuthenticated ? 'Мои проекты' : 'Собрать планировку'}
            </Link>
          </div>
        </div>
      </PublicLayout>
    </>
  );
};
