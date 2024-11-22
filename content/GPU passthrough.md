+++
title = "How to do a GPU passthrough on Beelink SER 5 - Ryzen 7 5800H with Proxmox to Ubuntu VM"
date = 2024-11-22
+++

After I installed Proxmox on my [Beelink SER 5 - Ryzen 7 5800H](https://www.bee-link.com/en-de/products/beelink-ser5-max-5800h) I wanted to start an Ubuntu VM with GPU passthrough that I could use as a daily driver.
As I had zero prior experience with doing something like this my process was full of following guides I barely understood, frustrating trial and error and reading about the things I just tried to do.
This journal describes this process.
It should not be seen as a complete guide, as I am far too inexperienced to verify if I did everything correctly.
But maybe it helps someone like me who is lost and googling error messages.

Before describing my journey I want to point out a few guides, with which I would not have been able to get it done:
 - [A guide that describes the process for the same machine I used but for a Windows VM](https://forum.proxmox.com/threads/guide-ryzen-5800h-igpu-passthrough-hdmi-windows11-htpc.153405/): This guide saved me. Before I found it I was close to giving up. So big shout outs.
 - [Comprehensive guide for Ryzen 7000 series GPU passthrough](https://github.com/isc30/ryzen-7000-series-proxmox/?tab=readme-ov-file#proxmox---ryzen-7000-series---amd-radeon-680m780mrdna2rdna3-gpu-passthrough): The guide above used this one for many steps.
 - [GPU passthrough to an Ubuntu VM, but with a NVIDIA GPU](https://nopresearcher.github.io/Proxmox-GPU-Passthrough-Ubuntu/): This was the first guide I started with and it got me on track. Unfortunately it did not work out of the box for me. (Probably because I also have a different GPU setup.) 

# My journey
After I ran head first into following a guide and not getting results I decided to take a step back and first gather more information on what a GPU passthrough even is.
I came up with the following description:

## GPU Passthrough
GPU Passthrough is a technique in virtualization and a form of PCI Passthrough, where the Graphics Processing Unit of the Hypervisor (for me Proxmox) host machine is directly assigned to a Virtual machine (VM).
This way the VM can access the GPU as if it is directly connected to it.

Normally a hypervisor provides virtual hardware to a VM and if this is done for a GPU one speaks of a virtual GPU (vGPU).
Here multiple VMs can have access to a real physical one, but this way a single VM may not be able to use the full potential of the GPU.
Additionally the hypervisor adds overhead to the communication leading to reduced performance.
Now GPU Passthrough acts as a solution to this problem, by bypassing the virtualization layer, giving the VM near native performance of the GPU.

### Steps to enable it
 1. **Enable Input-Output Memory Management Unit (IOMMU)**: IOMMU is necessary to isolate the GPU. It allows to map physical memory address to virtual ones and can therefore be used to restrict the access only to a single virtual machine.
 2. **Blacklist the host driver**: By blacklisting the host Driver of the GPU the host machine will no longer be able to access the GPU. This way the **Virtual Function IO (VFIO)** will be able to take control over it without any timing issues due to interference of the host machine.
 3. **Bind the GPU to the Virtual Function IO**: Here the VFIO acts as a driver that then has the control over the GPU and can give direct access to the VM. This way the host machine will no longer have access to it.
 4. **Assign the GPU to the VM**: After the GPU is bound to the VFIO one can assign it to any VM.
 5. **Install the necessary driver on the VM**: To ensure that the VM can actually use the assigned GPU the necessary driver need to be present.


## Naively following the steps

### 0. Define the VM that you want to launch
Here many guides exist like:
 - [YouTube: Everything You Need to Know to Start with Proxmox VE](https://www.youtube.com/watch?v=5j0Zb6x_hOk)
 - [YouTube: Don’t run Proxmox without these settings!](https://www.youtube.com/watch?v=VAJWUZ3sTSI)

For my case I just copied the download link from: [https://ubuntu.com/download/desktop](https://ubuntu.com/download/desktop) and then downloaded the image to the local storage.
Afterwards I did some standard configuration.
The only thing out of the ordinary was that I used OVMF for the BIOS.

<div class="info-box">
    OVMF stands for Open Virtual Machine Firmware, and it is an open-source implementation of the Unified Extensible Firmware Interface (UEFI) specification. 
    UEFI is a modern firmware interface that replaces the traditional BIOS (Basic Input/Output System) found in older systems. 
    UEFI offers several advantages over BIOS, including support for larger disk sizes, faster boot times, secure boot, and improved system management capabilities.
</div>

What I can recommend is to install ssh on the VM so that you can still access it without a GUI.
```
sudo apt update
sudo apt install openssh-server
sudo systemctl status ssh
```

### 1. Enable Input-Output Memory Management Unit (IOMMU)
The Input-Output Memory Management Unit (IOMMU) is a hardware features of modern CPUs that allows the Operating System (OS) to control how I/O devices access the memory.
It acts as a form of gatekeeper and is therefore similar to how the Memory Management Unit handles the access of the CPU to the memory

To enable it I needed to configure the Grand Unified Boot Loader (GRUB) of the host machine.
In a normal boot process the GRUB is started by the BIOS and is responsible for loading the operating system.
In my case with Proxmox it loads the Linux kernel.
The way it behaves can be configured in the `/etc/default/grub` file, which can be edited with `sudo nano /etc/default/grub`.
After an update the command `sudo update-grub` must be run to reload it.

To enable the IMMOU I often read that one has to add `iommu=on` or in my case with an AMD CPU `amd_iommu=on`.
In my trial and error process it turned out that I did not have to enable the IOMMU this way.
Instead I only set `iommu=pt`, by changing the line `GRUB_CMDLINE_LINUX_DEFAULT="quite"` to `GRUB_CMDLINE_LINUX_DEFAULT="quite iommu=pt"`.
As far as I know this should enable the passthrough mode in the IOMMU and enhance performance.

### 2. Blacklist the host driver
This step was rather straight forward.
I just had to execute:
```
echo "blacklist amdgpu" >> /etc/modprobe.d/blacklist.conf
echo "blacklist radeon" >> /etc/modprobe.d/blacklist.conf
```

This puts these two drivers in the blacklist, so they won't be automatically loaded in the boot process.

If you wonder about the `modprobe` in the path, this stands for a Linux command that bears the same name.
The command `modprobe` allows to load or unload a kernel module, in our case a driver.
By using `modprobe <module name>` the specified module is loaded in the Linux kernel.
This way the system can use the hardware that is specified by the module.
By adding the flag `-r` the module is unloaded.


### 3. Bind the GPU to the Virtual Function IO
To bind the GPU to the VFIO I first had to ensure that all necessary modules are loaded into the Linux kernel in the boot process.
To do this I executed the following command:
```bash
echo "vfio" >> /etc/modules
echo "vfio_iommu_type1" >> /etc/modules
echo "vfio_pci" >> /etc/modules
echo "vfio_virqfd" >> /etc/modules
```

Afterwards I needed to identify the GPU, which can be done by using `lspci -v` and looking for a "VGA compatible controller".
In my case:
```
04:00.0 VGA compatible controller: Advanced Micro Devices, Inc. [AMD/ATI] Cezanne [Radeon Vega Series / Radeon Vega Mobile Series] (rev c5) (prog-if 00 [VGA controller])
04:00.1 Audio device: Advanced Micro Devices, Inc. [AMD/ATI] Renoir Radeon High Definition Audio Controller
```

Here the first column is a combination of bus, device and function number.
In my case `04:00.0`:
 - `04`: Bus number.
 - `00`: Device number.
 - `0`: Function number.

This value can then be used to access further information by executing `lspci -n -s 04:00`, which yielded in my case:
```
04:00.0 0300: 1002:1638 (rev c5)
04:00.1 0403: 1002:1637
04:00.2 1080: 1022:15df
04:00.3 0c03: 1022:1639
04:00.4 0c03: 1022:1639
04:00.5 0480: 1022:15e2 (rev 01)
04:00.6 0403: 1022:15e3
```

Here the second column is the class code in hexadecimal, which provides information about the type of device.
The third column is the vendor and device id in the format `<vendor-id>:<product-id>`.
In my case `1022` stands for AMD and e.g. `1638` uniquely identifies a specific model of device from the vendor.
The last column is optional and is the Revision Id that indicates the specific version of a device.

For binding the GPU the important part is the `<vendor-id>:<product-id>`.
I used the top one (the GPU) and the second one (an audio device) and binded them using `echo "options vfio-pci ids=1002:1638, 1002:1637" > /etc/modprobe.d/vfio.conf`.

After a reboot one can execute `lspci -v` and check if the Kernel driver that is used for the GPU is now `vfio-pci` instead of the previous one (in my case it was `amdgpu`).


### 4. Assign the GPU to the VM
This can be easily be done via the Proxmox GUI using VM -> Hardware -> Add -> PCI Device.

But I ran into the issue that whenever I started the VM, my host machine would become unresponsive.
I could identify that this did not happen when I **did not check** the box "All Functions".

{{ image(src="/images/proxmox-gpu-all-functions.png", alt="", style="border-radius: 0px; float: center; padding: 10px; margin: 10px 0 10px 20px;") }}


### 5. Install the necessary driver on the VM
Since I used Ubuntu for the VM and an AMD GPU, I didn't have to install anything, as the `amdgpu` driver is readily available.


## Issues I ran into
While the steps described above sound nice and simple I encountered multiple issues.

### Missing BIOS ROM
After naively following the steps I did not receive any output at the display linked to the host machine when I started the VM.
After ssh-ing into the VM I could check via `sudo lshw -c display` that GPU was detected, but that the driver was not is use for it.
Further debugging by using `sudo dmesg` to check the kernel ring buffer revealed the following error logs:
```
amdgpu: Unable to locate a BIOS ROM
amdgpu: Fatal error during GPU init
```

This should mean more or less, that the GPU could not be initialized by the VM, because it can not access the GPU firmware stored on in the read-only memory (ROM).
I encountered this error, because I skipped an important step: Making the GPU BIOS available to the VM.

To fix this I wanted to extract GPU BIOS, by using the tool [amdvbflash](https://github.com/stylesuxx/amdvbflash) on the host machine, but here I had no success and only encountered the following error:
```
root@proxmox:~/flash-gpu# ./amdvbflash -i
AMDVBFLASH version 4.71, Copyright (c) 2020 Advanced Micro Devices, Inc.

Adapter not found
```
I am unsure, but I think the reason that this tool could not detect my GPU is due to my GPU being an AMD Cezanne one.
Cezanne is a codename for a specific architecture GPUs that combine both a CPU and a GPU on the same chip.
But I am not sure about that.

But I was in luck and [this guide here](https://forum.proxmox.com/threads/guide-ryzen-5800h-igpu-passthrough-hdmi-windows11-htpc.153405/) linked me to a description of the BIOS extraction process see here: [https://github.com/isc30/ryzen-7000-series-proxmox/?tab=readme-ov-file#configuring-the-gpu-in-the-windows-vm](https://github.com/isc30/ryzen-7000-series-proxmox/?tab=readme-ov-file#configuring-the-gpu-in-the-windows-vm).

Additionally I did the [following steps](https://github.com/isc30/ryzen-7000-series-proxmox/?tab=readme-ov-file#optional-getting-ovmf-uefi-bios-working-error-43) for the audio device.
But I do not know if this was necessary.

### Stuck at 800x600 resolution
After extracting the GPU BIOS finally got output on my display, but I could not adjust the resolution and was stuck at 800x600.
The reason for this was probably a bug called AMD GPU reset.
But I was again lucky and found another guide that described how to resolved it: [https://www.nicksherlock.com/2020/11/working-around-the-amd-gpu-reset-bug-on-proxmox/](https://www.nicksherlock.com/2020/11/working-around-the-amd-gpu-reset-bug-on-proxmox/)
After installing the vendor reset like describer in the post I could adjust my resolution.

### Redirect USB devices
As a final step I redirected my mouse and keyboard. 
For this I first detected the `<vendor-id>:<product-id>` of the devices using `lsusb` on the host machine.
Then I rebound them using:
`qm set <VM-ID> -usb0 host=<vendor-id>:<product-id>`.
