import { Button, Input, Label, Modal, TextField, useOverlayState } from '@heroui/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';

import { PROJECT_NAME_MAX_LENGTH, ProjectNameSchema } from '../../../../shared/projects';
import type { ProjectDto } from '../../../../shared/projects';
import { PROJECTS_QUERY_KEY } from '../../api/projectsQueryKeys';
import { renameProject } from '../../api/renameProject';

interface Props {
  project: ProjectDto | null;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

const SUBMIT_ERROR_MESSAGE = 'Не удалось сохранить название';
const EMPTY_NAME_ERROR = 'Введите название';
const TOO_LONG_ERROR = 'Максимум 60 символов';

interface RenameFormProps {
  project: ProjectDto;
  onClose: () => void;
}

/**
 * Внутренняя форма: монтируется, только когда модал открыт, — поэтому текущее имя
 * ставится в state и текст выделяется целиком при монтировании, без setState в
 * эффекте `isOpen`.
 */
const RenameForm: React.FC<RenameFormProps> = ({ project, onClose }) => {
  const queryClient = useQueryClient();

  const [name, setName] = useState(project.name);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const mutation = useMutation({
    mutationFn: renameProject,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
      onClose();
    },
    onError: () => {
      setSubmitError(SUBMIT_ERROR_MESSAGE);
    },
  });

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const isSubmitting = mutation.isPending;
  const isSubmitDisabled = isSubmitting || name.trim().length === 0;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (isSubmitting) return;

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setValidationError(EMPTY_NAME_ERROR);
      return;
    }
    if (trimmed.length > PROJECT_NAME_MAX_LENGTH) {
      setValidationError(TOO_LONG_ERROR);
      return;
    }
    const parsed = ProjectNameSchema.safeParse(name);
    if (!parsed.success) {
      setValidationError(EMPTY_NAME_ERROR);
      return;
    }
    setValidationError(null);
    setSubmitError(null);
    mutation.mutate({ id: project.id, payload: { name: parsed.data } });
  };

  const handleNameChange = (value: string): void => {
    setName(value);
    if (validationError && value.trim().length > 0) {
      setValidationError(null);
    }
    if (submitError) setSubmitError(null);
  };

  const errorLabel = validationError ?? submitError;

  return (
    <form className='flex flex-col gap-4' onSubmit={handleSubmit} noValidate>
      <Modal.Heading className='m-0 text-[22px] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]'>
        Переименовать
      </Modal.Heading>

      <TextField
        name='name'
        value={name}
        onChange={handleNameChange}
        isDisabled={isSubmitting}
        isInvalid={Boolean(errorLabel)}
        autoComplete='off'
      >
        <Label>Название</Label>
        <Input ref={inputRef} />
        {errorLabel ? <span className='mt-1 text-[12px] text-[color:oklch(38%_0.16_27)]'>{errorLabel}</span> : null}
      </TextField>

      <div className='mt-2 flex items-center justify-end gap-2 max-lg:justify-stretch'>
        <Button
          type='button'
          onPress={onClose}
          className='h-10 bg-[var(--surface-secondary)] text-[color:var(--foreground)] max-lg:h-11 max-lg:flex-1'
          isDisabled={isSubmitting}
        >
          Отмена
        </Button>
        <Button
          type='submit'
          isDisabled={isSubmitDisabled}
          isPending={isSubmitting}
          className='h-10 max-lg:h-11 max-lg:flex-1'
        >
          Сохранить
        </Button>
      </div>
    </form>
  );
};

/**
 * Модал переименования проекта. Управляется страницей через `isOpen` + `onOpenChange`.
 * Форма монтируется только при `isOpen && project !== null`, поэтому текущее имя и
 * фокус ставятся на монтировании, а закрытие модала гарантированно сбрасывает state.
 */
export const RenameProjectModal: React.FC<Props> = ({ project, isOpen, onOpenChange }) => {
  const state = useOverlayState({ isOpen, onOpenChange });

  return (
    <Modal state={state}>
      <Modal.Backdrop className='bg-black/40'>
        <Modal.Container placement='center' className='max-lg:!items-end max-lg:!p-0'>
          <Modal.Dialog className='w-full max-w-[344px] rounded-3xl bg-[var(--surface)] p-6 shadow-xl outline-none max-lg:max-w-full max-lg:rounded-b-none max-lg:rounded-t-3xl max-lg:px-4 max-lg:py-6'>
            {isOpen && project ? <RenameForm project={project} onClose={state.close} /> : null}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
};
