Pod::Spec.new do |s|
  s.name         = "SovraBleNative"
  s.version      = "1.0.0"
  s.summary      = "Sovra Bluetooth Low Energy Offline Mesh Native Module"
  s.homepage     = "https://sovra.network"
  s.license      = "MIT"
  s.authors      = { "Sovra Core Team" => "security@sovra.network" }
  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "https://github.com/sovra/sovra.git", :tag => "#{s.version}" }
  s.source_files = "SovraMobile/**/*.{h,m,mm,swift}"
  s.frameworks   = "CoreBluetooth", "Foundation"
  s.requires_arc = true
end
