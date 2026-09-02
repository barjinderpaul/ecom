export function createCategoriesService({ categoriesRepository }) {
  return {
    list() {
      return categoriesRepository.findAllWithCounts();
    },
  };
}
