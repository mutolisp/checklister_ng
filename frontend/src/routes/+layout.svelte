<script lang="ts">
  import "../app.css";
  import { Navbar, NavBrand, NavHamburger, NavUl, NavLi } from 'flowbite-svelte';
  import { page } from '$app/stores';
</script>

<main class="min-h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-white">
  <Navbar let:hidden let:toggle>
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
  </Navbar>
  <slot />
</main>
