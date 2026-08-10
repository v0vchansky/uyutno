import { Button, FieldError, Form, Input, Label, TextField } from '@heroui/react';
import axios from 'axios';
import type React from 'react';
import { useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { buildAuthUrl, normalizeFromParam } from '@app/auth';
import { PRIVACY_URL, PublicLayout, TERMS_URL, useRegistry } from '@app/common';

import { Route } from '../../../../shared/router/routes';

type FormStatus = 'idle' | 'submitting';

type EmailErrorKind = 'invalid' | 'taken';
type PasswordErrorKind = 'too-short' | 'weak';
type GeneralErrorKind = 'rate-limited' | 'unknown';

const EMAIL_ERROR_MESSAGES: Record<EmailErrorKind, string> = {
  invalid: 'Введите корректный email',
  taken: 'Этот email уже зарегистрирован',
};

const PASSWORD_ERROR_MESSAGES: Record<PasswordErrorKind, string> = {
  'too-short': 'Минимум 8 символов',
  weak: 'Должны быть и буквы, и цифры',
};

const GENERAL_ERROR_MESSAGES: Record<GeneralErrorKind, string> = {
  'rate-limited': 'Слишком много попыток, попробуйте позже',
  unknown: 'Что-то пошло не так, попробуйте ещё раз',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;
const PASSWORD_MIN_LENGTH = 8;

const validateEmail = (raw: string): EmailErrorKind | null => {
  const value = raw.trim();
  if (value.length === 0 || value.length > EMAIL_MAX_LENGTH) return 'invalid';
  return EMAIL_REGEX.test(value) ? null : 'invalid';
};

const validatePassword = (value: string): PasswordErrorKind | null => {
  if (value.length < PASSWORD_MIN_LENGTH) return 'too-short';
  const hasLetter = /[a-zA-Zа-яА-ЯёЁ]/.test(value);
  const hasDigit = /\d/.test(value);
  return hasLetter && hasDigit ? null : 'weak';
};

const useFromParam = (): string | null => {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search);
    return normalizeFromParam(params.get('from'));
  }, [location.search]);
};

const oauthStartUrl = (provider: 'yandex' | 'vk', from: string | null): string => {
  const base = `/api/v1/auth/oauth/${provider}/start`;
  return from ? `${base}?from=${encodeURIComponent(from)}` : base;
};

export const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { authManager } = useRegistry();
  const from = useFromParam();

  const emailInputRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<FormStatus>('idle');
  const [emailError, setEmailError] = useState<EmailErrorKind | null>(null);
  const [passwordError, setPasswordError] = useState<PasswordErrorKind | null>(null);
  const [generalError, setGeneralError] = useState<GeneralErrorKind | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (status === 'submitting') return;

    setEmailError(null);
    setPasswordError(null);
    setGeneralError(null);

    const emailIssue = validateEmail(email);
    const passwordIssue = validatePassword(password);
    if (emailIssue || passwordIssue) {
      setEmailError(emailIssue);
      setPasswordError(passwordIssue);
      return;
    }

    setStatus('submitting');
    try {
      await authManager.register({ email: email.trim().toLowerCase(), password });
      navigate(from ?? Route.Projects, { replace: true });
    } catch (error) {
      const response = axios.isAxiosError(error) ? error.response : undefined;
      const responseStatus = response?.status;
      const code = (response?.data as { code?: string } | undefined)?.code;

      if (responseStatus === 409 && code === 'email_taken') {
        setEmailError('taken');
        emailInputRef.current?.focus();
      } else if (responseStatus === 400) {
        setPasswordError('weak');
      } else if (responseStatus === 429) {
        setGeneralError('rate-limited');
      } else {
        setGeneralError('unknown');
      }
      setStatus('idle');
    }
  };

  const isSubmitting = status === 'submitting';
  const loginHref = buildAuthUrl('/login', from);

  return (
    <>
      <title>Регистрация в уютно</title>
      <meta
        name='description'
        content='Создайте аккаунт в уютно, чтобы сохранить планировку и вернуться к ней с любого компьютера.'
      />
      <PublicLayout>
        <div className='flex min-h-full items-center justify-center px-4 py-8 md:px-6 md:py-12'>
          <div className='flex w-full max-w-[400px] flex-col gap-6'>
            <header className='flex flex-col gap-2'>
              <h1 className='m-0 text-[22px] font-semibold tracking-[-0.02em] md:text-[28px]'>Создать аккаунт</h1>
              <p className='m-0 text-[14px] leading-[1.6] text-[color:var(--muted)] md:text-[16px]'>
                Чтобы сохранить планировку и вернуться к ней с любого компьютера
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
                  onChange={value => {
                    setEmail(value);
                    if (emailError) setEmailError(null);
                  }}
                  isDisabled={isSubmitting}
                  isInvalid={emailError !== null}
                  maxLength={EMAIL_MAX_LENGTH}
                >
                  <Label>Почта</Label>
                  <Input ref={emailInputRef} autoComplete='email' placeholder='name@example.ru' />
                  <FieldError>{emailError ? EMAIL_ERROR_MESSAGES[emailError] : null}</FieldError>
                </TextField>

                <TextField
                  isRequired
                  name='password'
                  type='password'
                  value={password}
                  onChange={value => {
                    setPassword(value);
                    if (passwordError) setPasswordError(null);
                  }}
                  isDisabled={isSubmitting}
                  isInvalid={passwordError !== null}
                >
                  <Label>Пароль</Label>
                  <Input autoComplete='new-password' placeholder='Не менее 8 символов' />
                  {passwordError ? (
                    <FieldError>{PASSWORD_ERROR_MESSAGES[passwordError]}</FieldError>
                  ) : (
                    <span className='text-[12px] leading-[1.5] text-[color:var(--muted)]'>
                      Буквы и цифры, минимум 8 символов
                    </span>
                  )}
                </TextField>

                {generalError ? (
                  <div
                    role='alert'
                    className='rounded-xl bg-[color:oklch(96%_0.02_27)] px-3 py-2.5 text-[13px] leading-[1.5] text-[color:oklch(38%_0.16_27)]'
                  >
                    {GENERAL_ERROR_MESSAGES[generalError]}
                  </div>
                ) : null}

                <Button type='submit' fullWidth isPending={isSubmitting} isDisabled={isSubmitting}>
                  {isSubmitting ? 'Создаём…' : 'Создать аккаунт'}
                </Button>

                <p className='m-0 text-[12px] leading-[1.5] text-[color:var(--muted)]'>
                  Создавая аккаунт, вы принимаете{' '}
                  <Link
                    to={TERMS_URL}
                    className='text-[color:var(--foreground-secondary)] underline-offset-2 hover:underline'
                  >
                    условия использования
                  </Link>{' '}
                  и{' '}
                  <Link
                    to={PRIVACY_URL}
                    className='text-[color:var(--foreground-secondary)] underline-offset-2 hover:underline'
                  >
                    политику конфиденциальности
                  </Link>
                  .
                </p>
              </Form>

              <div className='flex items-center gap-3'>
                <span className='h-px flex-1 bg-[var(--separator)]' />
                <span className='text-[13px] text-[color:var(--muted)]'>или</span>
                <span className='h-px flex-1 bg-[var(--separator)]' />
              </div>

              <div className='grid grid-cols-1 gap-2 min-[400px]:grid-cols-2'>
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
                <a
                  href={oauthStartUrl('vk', from)}
                  className='inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--surface)] text-[14px] font-medium text-[color:var(--foreground)] no-underline transition-colors hover:bg-[color:oklch(98%_0_0)]'
                >
                  <span
                    aria-hidden='true'
                    className='inline-flex h-[18px] w-[18px] items-center justify-center rounded-md bg-[#0077FF] text-[9px] font-bold leading-none text-white'
                  >
                    VK
                  </span>
                  VK ID
                </a>
              </div>
            </div>

            <p className='m-0 flex justify-center gap-1.5 text-[14px] text-[color:var(--muted)]'>
              <span>Уже есть аккаунт?</span>
              <Link to={loginHref} className='font-medium text-[color:var(--accent)] no-underline hover:underline'>
                Войти
              </Link>
            </p>
          </div>
        </div>
      </PublicLayout>
    </>
  );
};
