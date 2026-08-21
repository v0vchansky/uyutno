import { PROJECTS_QUERY_KEY, projectQueryKey } from './projectsQueryKeys';

/**
 * Единственное, что держит обещание «переименование обновляет и шапку редактора, и галерею» после того,
 * как открытие проекта ушло со списка на ручку одного проекта (задача 0095): ключ карточки — **потомок**
 * ключа галереи, а react-query инвалидирует по префиксу. Сломается вложенность — уже существующий
 * `invalidateQueries({ queryKey: PROJECTS_QUERY_KEY })` в `RenameProjectModal` перестанет доставать
 * карточку, и шапка застынет со старым именем до перезагрузки. Проверять это в рантайме нечем: ошибка
 * тихая, видна только глазами на живом переименовании.
 */
describe('projectQueryKey — связь карточки проекта с галереей', () => {
  it('ключ карточки начинается с ключа списка проектов', () => {
    expect(projectQueryKey('p1').slice(0, PROJECTS_QUERY_KEY.length)).toEqual([...PROJECTS_QUERY_KEY]);
  });

  it('ключ карточки длиннее ключа списка — это не тот же самый запрос', () => {
    expect(projectQueryKey('p1').length).toBeGreaterThan(PROJECTS_QUERY_KEY.length);
  });

  it('у разных проектов ключи разные', () => {
    expect(projectQueryKey('p1')).not.toEqual(projectQueryKey('p2'));
  });
});
