<script lang="ts">
  import "../app.css";
  import { onMount } from 'svelte';
  import { Navbar, NavHamburger, NavUl, NavLi, Dropdown, DropdownItem, DropdownDivider, Button } from 'flowbite-svelte';
  import { ChevronDownOutline } from 'flowbite-svelte-icons';
  import { page } from '$app/stores';
  import { currentProjectId, projectList, loadProjects, loadProject, newProject, saveProject, deleteProject } from '$stores/projectStore';
  import { syncPreferencesFromDB } from '$stores/profileStore';
  import ProjectEditModal from '$lib/ProjectEditModal.svelte';

  onMount(() => {
    loadProjects();
    syncPreferencesFromDB();
  });

  $: currentProject = $projectList.find(p => p.id === $currentProjectId);

  let showProjectModal = false;
  let projectModalMode: 'new' | 'edit' = 'new';

  function handleNew() {
    newProject();
    projectModalMode = 'new';
    showProjectModal = true;
  }

  function handleEdit() {
    projectModalMode = 'edit';
    showProjectModal = true;
  }

  async function handleSaveFromModal() {
    const id = await saveProject();
    if (id) {
      // 不 alert，modal 關閉就行
    }
  }

  async function handleLoadProject(id: number) {
    await loadProject(id);
  }

  async function handleDeleteProject(id: number, name: string) {
    if (confirm(`確定要刪除專案「${name}」嗎？此操作無法復原。`)) {
      await deleteProject(id);
    }
  }
</script>

<main class="min-h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-white">
  <Navbar let:hidden let:toggle class="relative z-[10000]">
    <h1 class="text-2xl font-bold mb-2">checklister-ng 名錄產生器</h1>
    <NavHamburger on:click={toggle} />
    <NavUl {hidden} class="ms-3 pt-6">
      <NavLi href="/" active={$page.url.pathname === '/'}>Home</NavLi>
      <NavLi href="/taxonomy" active={$page.url.pathname === '/taxonomy'}>Taxonomy</NavLi>
      <NavLi href="/map" active={$page.url.pathname === '/map'}>Map</NavLi>
      <NavLi href="/compare" active={$page.url.pathname === '/compare'}>Compare</NavLi>
      <NavLi href="/documentation">Docs</NavLi>
      <NavLi href="/admin" active={$page.url.pathname === '/admin'}>Admin</NavLi>
    </NavUl>

    <div class="flex items-center gap-2 ms-auto">
      <Button size="xs" color="alternative" class="hidden md:flex">
        {currentProject ? currentProject.name : '未儲存專案'}
        <ChevronDownOutline class="w-3 h-3 ms-1" />
      </Button>
      <Dropdown class="w-64" style="z-index: 99999;">
        <DropdownItem on:click={handleNew}>
          <span class="font-medium">+ 新建專案</span>
        </DropdownItem>
        {#if $currentProjectId}
          <DropdownItem on:click={handleEdit}>
            <span class="font-medium">編輯專案資訊</span>
          </DropdownItem>
          <DropdownItem on:click={handleSaveFromModal}>
            <span class="font-medium">儲存</span>
          </DropdownItem>
        {:else}
          <DropdownItem on:click={() => { projectModalMode = 'edit'; showProjectModal = true; }}>
            <span class="font-medium">設定專案資訊後儲存</span>
          </DropdownItem>
        {/if}
        {#if $projectList.length > 0}
          <DropdownDivider />
          <div class="px-3 py-1 text-xs text-gray-400">已儲存的專案</div>
          {#each $projectList as proj}
            <DropdownItem class="flex items-center justify-between group">
              <button class="flex-1 text-left truncate" on:click={() => handleLoadProject(proj.id)}>
                <span class="text-sm">{proj.name}</span>
                <span class="text-xs text-gray-400 ml-1">{proj.species_count}種</span>
              </button>
              <button
                class="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 ml-2"
                on:click|stopPropagation={() => handleDeleteProject(proj.id, proj.name)}
              >刪除</button>
            </DropdownItem>
          {/each}
        {/if}
      </Dropdown>
    </div>
  </Navbar>
  <slot />
</main>

<ProjectEditModal
  bind:open={showProjectModal}
  mode={projectModalMode}
  onSave={handleSaveFromModal}
/>
