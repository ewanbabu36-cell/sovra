terraform {
  required_version = ">= 1.5.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

resource "azurerm_resource_group" "sovra_rg" {
  name     = "${var.node_moniker}-rg"
  location = var.location
}

resource "azurerm_virtual_network" "sovra_vnet" {
  name                = "${var.node_moniker}-vnet"
  address_space       = [var.vnet_cidr]
  location            = azurerm_resource_group.sovra_rg.location
  resource_group_name = azurerm_resource_group.sovra_rg.name
}

resource "azurerm_subnet" "sentry_subnet" {
  name                 = "sentry-subnet"
  resource_group_name  = azurerm_resource_group.sovra_rg.name
  virtual_network_name = azurerm_virtual_network.sovra_vnet.name
  address_prefixes     = [var.sentry_subnet_cidr]
}

resource "azurerm_subnet" "validator_subnet" {
  name                 = "validator-subnet"
  resource_group_name  = azurerm_resource_group.sovra_rg.name
  virtual_network_name = azurerm_virtual_network.sovra_vnet.name
  address_prefixes     = [var.validator_subnet_cidr]
}

resource "azurerm_public_ip" "sentry_pip" {
  name                = "${var.node_moniker}-pip"
  resource_group_name = azurerm_resource_group.sovra_rg.name
  location            = azurerm_resource_group.sovra_rg.location
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_network_interface" "sentry_nic" {
  name                = "${var.node_moniker}-sentry-nic"
  location            = azurerm_resource_group.sovra_rg.location
  resource_group_name = azurerm_resource_group.sovra_rg.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.sentry_subnet.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.sentry_pip.id
  }
}

resource "azurerm_network_interface" "validator_nic" {
  name                = "${var.node_moniker}-val-nic"
  location            = azurerm_resource_group.sovra_rg.location
  resource_group_name = azurerm_resource_group.sovra_rg.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.validator_subnet.id
    private_ip_address_allocation = "Dynamic"
  }
}

resource "azurerm_linux_virtual_machine" "core_validator" {
  name                = "${var.node_moniker}-core"
  resource_group_name = azurerm_resource_group.sovra_rg.name
  location            = azurerm_resource_group.sovra_rg.location
  size                = "Standard_D4s_v5"
  admin_username      = "sovra"

  network_interface_ids = [
    azurerm_network_interface.validator_nic.id,
  ]

  admin_ssh_key {
    username   = "sovra"
    public_key = var.admin_ssh_public_key
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = 200
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }
}

resource "azurerm_linux_virtual_machine" "sentry_node" {
  name                = "${var.node_moniker}-sentry"
  resource_group_name = azurerm_resource_group.sovra_rg.name
  location            = azurerm_resource_group.sovra_rg.location
  size                = "Standard_D4s_v5"
  admin_username      = "sovra"

  network_interface_ids = [
    azurerm_network_interface.sentry_nic.id,
  ]

  admin_ssh_key {
    username   = "sovra"
    public_key = var.admin_ssh_public_key
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = 250
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }
}
