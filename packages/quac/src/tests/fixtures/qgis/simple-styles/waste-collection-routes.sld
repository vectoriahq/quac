<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1.0" xmlns:ogc="http://www.opengis.net/ogc" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.1.0/StyledLayerDescriptor.xsd" xmlns:se="http://www.opengis.net/se">
 <NamedLayer>
  <se:Name>Waste_Collection_Routes</se:Name>
  <UserStyle>
   <se:Name>default</se:Name>
   <se:FeatureTypeStyle>
    <se:Rule>
     <se:Name>Monday</se:Name>
     <se:Description>
      <se:Title>Monday</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>collection_day</ogc:PropertyName>
       <ogc:Literal>Monday</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:LineSymbolizer>
      <se:Stroke>
       <se:SvgParameter name="stroke">#0044cc</se:SvgParameter>
       <se:SvgParameter name="stroke-width">4</se:SvgParameter>
       <se:SvgParameter name="stroke-linejoin">round</se:SvgParameter>
       <se:SvgParameter name="stroke-linecap">round</se:SvgParameter>
      </se:Stroke>
     </se:LineSymbolizer>
    </se:Rule>
    <se:Rule>
     <se:Name>Wednesday</se:Name>
     <se:Description>
      <se:Title>Wednesday</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>collection_day</ogc:PropertyName>
       <ogc:Literal>Wednesday</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:LineSymbolizer>
      <se:Stroke>
       <se:SvgParameter name="stroke">#00aa44</se:SvgParameter>
       <se:SvgParameter name="stroke-width">4</se:SvgParameter>
       <se:SvgParameter name="stroke-linejoin">round</se:SvgParameter>
       <se:SvgParameter name="stroke-linecap">round</se:SvgParameter>
      </se:Stroke>
     </se:LineSymbolizer>
    </se:Rule>
    <se:Rule>
     <se:Name>Friday</se:Name>
     <se:Description>
      <se:Title>Friday</se:Title>
     </se:Description>
     <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
      <ogc:PropertyIsEqualTo>
       <ogc:PropertyName>collection_day</ogc:PropertyName>
       <ogc:Literal>Friday</ogc:Literal>
      </ogc:PropertyIsEqualTo>
     </ogc:Filter>
     <se:LineSymbolizer>
      <se:Stroke>
       <se:SvgParameter name="stroke">#cc0000</se:SvgParameter>
       <se:SvgParameter name="stroke-width">4</se:SvgParameter>
       <se:SvgParameter name="stroke-linejoin">round</se:SvgParameter>
       <se:SvgParameter name="stroke-linecap">round</se:SvgParameter>
      </se:Stroke>
     </se:LineSymbolizer>
    </se:Rule>
   </se:FeatureTypeStyle>
  </UserStyle>
 </NamedLayer>
</StyledLayerDescriptor>
