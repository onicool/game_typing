// In-process, offline system WebKit renderer. HTML is loaded from memory only.
import AppKit
import WebKit
import CoreText

let directory=URL(fileURLWithPath:CommandLine.arguments[1])
let specs:[(String,Int,Int)]=[("01_dive",1920,1080),("02_mirror",1920,1080),("03_vuln_report",1920,1080),("04_result_card",1200,630)]

final class Renderer:NSObject,WebFrameLoadDelegate {
    var view:WebView!
    var window:NSWindow!
    var index=0
    var results:[[String:Any]]=[]
    func fail(_ message:String)->Never{fputs(message+"\n",stderr);exit(1)}
    func start(){
        view=WebView(frame:NSRect(x:0,y:0,width:1920,height:1080),frameName:nil,groupName:nil)
        view.frameLoadDelegate=self
        view.preferences.isJavaScriptEnabled=true
        view.preferences.loadsImagesAutomatically=true
        window=NSWindow(contentRect:view.frame,styleMask:.borderless,backing:.buffered,defer:false)
        window.contentView=view
        next()
    }
    func next(){
        if index>=specs.count {
            let report:[String:Any]=["renderer":"macOS system WebKit / in-process / offline HTML from memory", "checks":results]
            do{try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]).write(to:directory.appendingPathComponent("verification.json"))}catch{fail(error.localizedDescription)}
            NSApp.terminate(nil);return
        }
        let(name,width,height)=specs[index]
        window.setContentSize(NSSize(width:width,height:height))
        view.frame=NSRect(x:0,y:0,width:width,height:height)
        do{let html=try String(contentsOf:directory.appendingPathComponent(name+".html"),encoding:.utf8);view.mainFrame.loadHTMLString(html,baseURL:nil)}catch{fail(error.localizedDescription)}
    }
    func webView(_ sender:WebView!,didFinishLoadFor frame:WebFrame!){
        guard frame===view.mainFrame else{return}
        DispatchQueue.main.asyncAfter(deadline:.now()+0.5){self.capture()}
    }
    func capture(){
        let(name,width,height)=specs[index]
        let audit = #"""
        JSON.stringify((()=>{
          const s=document.querySelector('.screen').getBoundingClientRect();
          const p=document.querySelector('.input-panel');
          const texts=[...document.querySelectorAll('.word,.reading,.romaji,.typed')].map(el=>{
            const bad=[];for(let a=el;a;a=a.parentElement){const cs=getComputedStyle(a);if(cs.filter!=='none'||cs.textShadow!=='none')bad.push({tag:a.tagName,filter:cs.filter,shadow:cs.textShadow});}
            return {text:el.textContent,ancestorEffects:bad,font:getComputedStyle(el).fontFamily};
          });
          const overflow=[...document.querySelectorAll('.panel,.keyrow,.vuln-row,.nearmiss,.metric')].filter(el=>el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1).map(el=>el.className);
          return {name:NAME,dimensions:{width:s.width,height:s.height},inputPanelCount:document.querySelectorAll('.input-panel').length,
            inputPanel:p?{x:p.offsetLeft,y:p.offsetTop,width:p.offsetWidth,height:p.offsetHeight,background:getComputedStyle(p).backgroundColor}:null,
            crisp:texts,selfContained:!document.querySelector('script[src],link[href],img[src]:not([src^="data:"]),iframe'),
            japaneseText:document.body.innerText.match(/[\u3040-\u30ff\u4e00-\u9fff]+/g),overflow};
        })())
        """#.replacingOccurrences(of:"NAME",with:"'"+name+"'")
        guard let json=view.stringByEvaluatingJavaScript(from:audit),let data=json.data(using:.utf8) else{fail("No DOM audit")}
        do{
            guard var result=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{fail("Invalid audit")}
            guard result["selfContained"] as? Bool==true else{fail("External assets detected")}
            let strings=result["japaneseText"] as? [String] ?? []
            let font=CTFontCreateWithName("HiraginoSans-W3" as CFString,16,nil)
            let chars=Array(Set(strings.joined().utf16)).sorted()
            var glyphs=[CGGlyph](repeating:0,count:chars.count)
            let covered=CTFontGetGlyphsForCharacters(font,chars,&glyphs,chars.count)
            result["japaneseFontVerification"]=["font":CTFontCopyPostScriptName(font),"uniqueGlyphs":chars.count,"allCovered":covered,"missingCodepoints":zip(chars,glyphs).filter{$0.1==0}.map{Int($0.0)}] as [String:Any]
            guard covered else{fail("Japanese font coverage failure")}
            if let textChecks=result["crisp"] as? [[String:Any]],textChecks.contains(where:{($0["ancestorEffects"] as? [Any] ?? []).count>0}){fail("Effects applied to protected text")}
            if name=="01_dive"||name=="02_mirror" {
                guard result["inputPanelCount"] as? Int==1 else{fail("Input panel count")}
                guard let panel=result["inputPanel"] as? [String:Any],panel["background"] as? String=="rgb(8, 15, 22)" else{fail("Input opacity")}
            }
            view.layoutSubtreeIfNeeded()
            view.displayIfNeeded()
            guard let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:width,pixelsHigh:height,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0) else{fail("Bitmap creation failed")}
            bitmap.size=NSSize(width:width,height:height)
            view.cacheDisplay(in:view.bounds,to:bitmap)
            guard let png=bitmap.representation(using:.png,properties:[:]) else{fail("PNG encoding failed")}
            try png.write(to:directory.appendingPathComponent(name+".png"))
            results.append(result)
            print("\(name).png: \(width) × \(height); \(chars.count) Japanese glyphs verified")
            fflush(stdout)
            index+=1;next()
        }catch{fail(error.localizedDescription)}
    }
}
let app=NSApplication.shared
app.setActivationPolicy(.prohibited)
let renderer=Renderer()
renderer.start()
app.run()
