<!-- src/routes/documentation/+page.svelte -->
<script>
  import { onMount } from 'svelte';
  import { Navbar, NavBrand, NavHamburger, NavUl, NavLi } from 'flowbite-svelte';
  import { DownloadSolid, ChevronDownOutline, TrashBinOutline,
		   FileOutline, FileCodeOutline, FileWordOutline
		   } from 'flowbite-svelte-icons';
</script>
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
<h1 class="text-2xl font-bold my-4">API Documentation</h1>

<div class="border rounded shadow-md overflow-hidden">
  <iframe
    src="http://localhost:8000/docs"
    class="w-full h-[80vh] border-none"
  ></iframe>
</div>
