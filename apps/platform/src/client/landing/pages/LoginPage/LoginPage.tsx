import { Button, FieldError, Form, Input, Label, TextField } from '@heroui/react';
import axios from 'axios';
import type React from 'react';
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { buildAuthUrl, normalizeFromParam } from '@app/auth';
import { PublicLayout, useRegistry } from '@app/common';

import { Route } from '../../../../shared/router/routes';

type FormStatus = 'idle' | 'submitting';

type FormErrorKind = 'invalid-credentials' | 'rate-limited' | 'oauth-email-taken' | 'oauth-no-email' | 'unknown';

const FORM_ERROR_MESSAGES: Record<FormErrorKind, string> = {
  'invalid-credentials': 'Неверная почта или пароль',
  'rate-limited': 'Слишком много попыток, попробуйте позже',
  'oauth-email-taken': 'Этот email уже зарегистрирован. Войдите паролем и привяжите Yandex из настроек.',
  'oauth-no-email': 'Провайдер не вернул email. Войдите паролем.',
  unknown: 'Что-то пошло не так, попробуйте ещё раз',
};

const errorKindFromStatus = (status: number | undefined): FormErrorKind => {
  if (status === 401) return 'invalid-credentials';
  if (status === 429) return 'rate-limited';
  return 'unknown';
};

const oauthErrorFromQuery = (raw: string | null): FormErrorKind | null => {
  if (raw === 'oauth_email_taken') return 'oauth-email-taken';
  if (raw === 'oauth_no_email') return 'oauth-no-email';
  return null;
};

const useFromParam = (): string | null => {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search);
    return normalizeFromParam(params.get('from'));
  }, [location.search]);
};

const useOAuthErrorFromQuery = (): FormErrorKind | null => {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search);
    return oauthErrorFromQuery(params.get('error'));
  }, [location.search]);
};

const oauthStartUrl = (provider: 'yandex', from: string | null): string => {
  const base = `/api/v1/auth/oauth/${provider}/start`;
  return from ? `${base}?from=${encodeURIComponent(from)}` : base;
};

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { authManager } = useRegistry();
  const from = useFromParam();
  const oauthError = useOAuthErrorFromQuery();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<FormStatus>('idle');
  const [formError, setFormError] = useState<FormErrorKind | null>(null);

  const activeError = formError ?? oauthError;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (status === 'submitting') return;

    setFormError(null);
    setStatus('submitting');
    try {
      await authManager.login({ email: email.trim().toLowerCase(), password });
      navigate(from ?? Route.Projects, { replace: true });
    } catch (error) {
      const responseStatus = axios.isAxiosError(error) ? error.response?.status : undefined;
      setFormError(errorKindFromStatus(responseStatus));
      setStatus('idle');
    }
  };

  const isSubmitting = status === 'submitting';
  const registerHref = buildAuthUrl('/register', from);
  const forgotHref = buildAuthUrl('/forgot-password', from);

  return (
    <>
      <title>Вход в уютно</title>
      <meta name='description' content='Войдите в уютно, чтобы продолжить работу над планировками.' />
      <PublicLayout mode='auth'>
        <div className='flex min-h-full items-center justify-center px-4 py-8 md:px-6 md:py-12'>
          <div className='flex w-full max-w-[400px] flex-col gap-6'>
            <header className='flex flex-col gap-2'>
              <h1 className='m-0 text-[22px] font-semibold tracking-[-0.02em] md:text-[28px]'>Вход</h1>
              <p className='m-0 text-[14px] leading-[1.6] text-[color:var(--muted)] md:text-[16px]'>
                Продолжить работу над планировками
              </p>
            </header>

            <div className='flex flex-col gap-6 rounded-3xl bg-[var(--surface-secondary)] p-6 md:p-8'>
              <Form className='flex flex-col gap-4' onSubmit={handleSubmit} validationBehavior='aria'>
                <TextField
                  autoFocus
                  isRequired
                  name='email'
                  type='email'
                  value={email}
                  onChange={setEmail}
                  isDisabled={isSubmitting}
                  maxLength={254}
                >
                  <Label>Почта</Label>
                  <Input autoComplete='email' placeholder='name@example.ru' />
                  <FieldError>Введите корректный email</FieldError>
                </TextField>

                <TextField
                  isRequired
                  name='password'
                  type='password'
                  value={password}
                  onChange={setPassword}
                  isDisabled={isSubmitting}
                >
                  <div className='flex items-baseline justify-between gap-3'>
                    <Label>Пароль</Label>
                    <Link
                      to={forgotHref}
                      className='text-[13px] text-[color:var(--muted)] no-underline transition-colors hover:text-[color:var(--accent)]'
                    >
                      Забыли пароль?
                    </Link>
                  </div>
                  <Input autoComplete='current-password' placeholder='••••••••' />
                </TextField>

                {activeError ? (
                  <div
                    role='alert'
                    className='rounded-xl bg-[color:oklch(96%_0.02_27)] px-3 py-2.5 text-[13px] leading-[1.5] text-[color:oklch(38%_0.16_27)]'
                  >
                    {FORM_ERROR_MESSAGES[activeError]}
                  </div>
                ) : null}

                <Button type='submit' fullWidth isPending={isSubmitting} isDisabled={isSubmitting}>
                  {isSubmitting ? 'Входим…' : 'Войти'}
                </Button>
              </Form>

              <div className='flex items-center gap-3'>
                <span className='h-px flex-1 bg-[var(--separator)]' />
                <span className='text-[13px] text-[color:var(--muted)]'>или</span>
                <span className='h-px flex-1 bg-[var(--separator)]' />
              </div>

              <a
                href={oauthStartUrl('yandex', from)}
                className='inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--surface)] text-[14px] font-medium text-[color:var(--foreground)] no-underline transition-colors hover:bg-[color:oklch(98%_0_0)]'
              >
                <span
                  aria-hidden='true'
                  className='inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#FC3F1D] text-[12px] font-semibold leading-none text-white'
                >
                  Я
                </span>
                Yandex ID
              </a>
            </div>

            <p className='m-0 flex justify-center gap-1.5 text-[14px] text-[color:var(--muted)]'>
              <span>Ещё нет аккаунта?</span>
              <Link to={registerHref} className='font-medium text-[color:var(--accent)] no-underline hover:underline'>
                Зарегистрироваться
              </Link>
            </p>
          </div>
        </div>
      </PublicLayout>
    </>
  );
};
