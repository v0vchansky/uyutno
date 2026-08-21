import { Button, Modal, useOverlayState } from '@heroui/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { useState } from 'react';

import type { ProjectDto } from '../../../../shared/projects';
import { deleteProject } from '../../api/deleteProject';
import { PROJECTS_QUERY_KEY } from '../../api/projectsQueryKeys';

interface Props {
  project: ProjectDto | null;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

const SUBMIT_ERROR_MESSAGE = 'Не удалось удалить проект';

interface DeleteFormProps {
  project: ProjectDto;
  onClose: () => void;
}

/**
 * Внутренняя часть модала: монтируется только при открытии. Ошибка сервера показывается
 * инлайн-строкой под кнопками, модал при этом остаётся открытым.
 */
const DeleteBody: React.FC<DeleteFormProps> = ({ project, onClose }) => {
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
      onClose();
    },
    onError: () => {
      setSubmitError(SUBMIT_ERROR_MESSAGE);
    },
  });

  const isSubmitting = mutation.isPending;

  const handleConfirm = (): void => {
    if (isSubmitting) return;
    setSubmitError(null);
    mutation.mutate(project.id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleConfirm();
    }
  };

  return (
    <div className='flex flex-col gap-4' onKeyDown={handleKeyDown}>
      <Modal.Heading className='m-0 text-[22px] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]'>
        Удалить проект?
      </Modal.Heading>

      <p className='m-0 text-[14px] text-[color:var(--foreground)]'>
        «{project.name}» удалится вместе с планировкой. Восстановить не получится.
      </p>

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
          type='button'
          onPress={handleConfirm}
          isPending={isSubmitting}
          className='h-10 bg-[#C63C2E] text-white hover:bg-[#9F3226] max-lg:h-11 max-lg:flex-1'
        >
          Удалить
        </Button>
      </div>

      {submitError ? <span className='text-[12px] text-[color:var(--form-error)]'>{submitError}</span> : null}
    </div>
  );
};

/**
 * Модал подтверждения удаления. Кнопка «Удалить» — жёсткий терракотовый danger
 * (#C63C2E → #9F3226); подтверждение вводом названия не требуется — v0-скоуп.
 */
export const DeleteProjectModal: React.FC<Props> = ({ project, isOpen, onOpenChange }) => {
  const state = useOverlayState({ isOpen, onOpenChange });

  return (
    <Modal state={state}>
      <Modal.Backdrop className='bg-black/40'>
        <Modal.Container placement='center' className='max-lg:!items-end max-lg:!p-0'>
          <Modal.Dialog className='w-full max-w-[344px] rounded-3xl bg-[var(--surface)] p-6 shadow-xl outline-none max-lg:max-w-full max-lg:rounded-b-none max-lg:rounded-t-3xl max-lg:px-4 max-lg:py-6'>
            {isOpen && project ? <DeleteBody project={project} onClose={state.close} /> : null}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
};
