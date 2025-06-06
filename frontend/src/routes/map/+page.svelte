<!-- src/routes/map/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { Navbar, NavBrand, NavHamburger, NavUl, NavLi } from 'flowbite-svelte';
  import { DownloadSolid, ChevronDownOutline, TrashBinOutline,
		   FileOutline, FileCodeOutline, FileWordOutline
		   } from 'flowbite-svelte-icons';
  import MapEditor from '$lib/MapEditor.svelte';

</script>
<!-- navigation bar -->
<Navbar let:hidden let:toggle>
<h1 class="text-2xl font-bold mb-2">checklister-ng 名錄產生器</h1>
<NavHamburger on:click={toggle} />
<NavUl {hidden} class="ms-3 pt-6">
    <NavLi href="/" active={true}>Home</NavLi>
    <NavLi class="cursor-pointer">App</NavLi>
    <NavLi href="/documentation">Docs</NavLi>
    <NavLi href="/contact">Contact</NavLi>
</NavUl>
</Navbar> 

<h1 class="text-2xl font-bold mb-4">📍 樣區繪製工具</h1>
<MapEditor />
